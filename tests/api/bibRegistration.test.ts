import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  requireConfirmedUser: vi.fn(),
}));

vi.mock("@/lib/supabaseServer", () => ({
  getSupabaseAdmin: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/auth/session", async (original) => ({
  ...(await original<object>()),
  requireConfirmedUser: mocks.requireConfirmedUser,
}));

import { POST as lookup } from "@/app/api/auth/bib/lookup/route";
import { DELETE as reject, POST as accept } from "@/app/api/auth/bib/accept/route";
import { POST as link } from "@/app/api/auth/bib/link/route";
import { AuthenticationError, UnconfirmedEmailError } from "@/lib/auth/session";
import { beginBibSignup, finalizeBibSignup } from "@/lib/auth/bibRegistration";

const origin = "https://marathon.example";
const userId = "00000000-0000-4000-8000-000000000001";
const runnerId = "00000000-0000-4000-8000-000000000002";
const previewTicket = "a".repeat(43);
const acceptedTicket = "b".repeat(43);
const acceptedCookie = "mw_bib_acceptance=" + acceptedTicket;
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

function request(
  action: "lookup" | "accept" | "link",
  body?: unknown,
  options: { method?: string; origin?: string; cookie?: string; contentType?: string } = {},
) {
  const headers = new Headers({
    Origin: options.origin ?? origin,
    "Content-Type": options.contentType ?? "application/json",
  });
  if (options.cookie) headers.set("Cookie", options.cookie);
  return new Request(origin + "/api/auth/bib/" + action, {
    method: options.method ?? "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("BIB signup HTTP boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.rpc.mockImplementation(async (rpc: string) => {
      if (rpc === "revoke_bib_ticket") return { error: null, data: null };
      if (rpc === "consume_bib_rate_limit") return { error: null, data: true };
      throw new Error("Unhandled RPC " + rpc);
    });
    mocks.requireConfirmedUser.mockResolvedValue({
      id: userId,
      email: "runner@example.test",
      emailConfirmedAt: "2026-11-20T00:00:00.000Z",
    });
  });

  it("scopes an opaque lookup to the requested edition and preserves leading zeroes", async () => {
    mocks.rpc.mockImplementation(async (rpc: string) => {
      if (rpc === "consume_bib_rate_limit") return { error: null, data: true };
      return { error: null, data: [{
        bib: "00123", name: "Rani Prima", distance: "5K",
        runner_id: runnerId, email: "roster@example.test",
      }] };
    });

    const response = await lookup(request("lookup", { eventId: 17, bib: " 00123 " }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body).toEqual({
      ticket: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      match: { bib: "00123", name: "Rani Prima", distance: "5K" },
    });
    expect(mocks.rpc).toHaveBeenCalledWith("lookup_published_bib", {
      p_event_id: 17,
      p_bib: "00123",
      p_ticket_hash: sha256(body.ticket),
    });
  });

  it("revokes the previous acceptance when starting a new lookup", async () => {
    mocks.rpc.mockImplementation(async (rpc: string) => ({
      error: null,
      data: rpc === "lookup_published_bib" ? [] : true,
    }));
    const response = await lookup(request("lookup", { eventId: 17, bib: "00234" }, {
      cookie: acceptedCookie,
    }));
    expect(response.status).toBe(404);
    expect(mocks.rpc.mock.calls.map(([rpc]) => rpc)).toEqual([
      "consume_bib_rate_limit", "revoke_bib_ticket", "lookup_published_bib",
    ]);
    expect(mocks.rpc).toHaveBeenCalledWith("revoke_bib_ticket", {
      p_ticket_hash: sha256(acceptedTicket),
    });
    expect(response.headers.get("set-cookie")).toMatch(/mw_bib_acceptance=;.*Max-Age=0/i);
  });

  it("returns HTTP 429 before looking up a BIB when the shared limit is hit", async () => {
    mocks.rpc.mockResolvedValue({ error: null, data: false });
    const response = await lookup(request("lookup", { eventId: 17, bib: "00123" }));
    expect(response.status).toBe(429);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("consume_bib_rate_limit", {
      p_bucket: "lookup", p_key: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it("accepts a preview by rotating the ticket and setting a matching private cookie", async () => {
    const expiry = new Date(Date.now() + 10 * 60_000);
    mocks.rpc.mockImplementation(async (rpc: string) => ({
      error: null,
      data: rpc === "accept_bib_ticket" ? expiry.toISOString() : true,
    }));
    const response = await accept(request("accept", { ticket: previewTicket }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: true });
    const cookie = response.headers.get("set-cookie") ?? "";
    const accepted = cookie.match(/^mw_bib_acceptance=([A-Za-z0-9_-]{43});/)?.[1];
    expect(accepted).toBeDefined();
    expect(accepted).not.toBe(previewTicket);
    expect(cookie).toContain("Path=/api/auth");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=lax");
    expect(cookie).toContain("Expires=" + expiry.toUTCString());
    expect(mocks.rpc).toHaveBeenCalledWith("accept_bib_ticket", {
      p_ticket_hash: sha256(previewTicket),
      p_accepted_ticket_hash: sha256(accepted!),
    });
  });

  it("does not set an acceptance cookie for an expired or replayed preview", async () => {
    mocks.rpc.mockImplementation(async (rpc: string) => ({
      error: null,
      data: rpc === "accept_bib_ticket" ? null : true,
    }));
    const response = await accept(request("accept", { ticket: previewTicket }));
    expect(response.status).toBe(409);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("invalidates explicitly rejected previews and any acceptance cookie", async () => {
    const response = await reject(request("accept", { ticket: previewTicket }, {
      method: "DELETE",
      cookie: acceptedCookie,
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(/mw_bib_acceptance=;.*Max-Age=0/i);
    expect(mocks.rpc).toHaveBeenCalledWith("revoke_bib_ticket", {
      p_ticket_hash: sha256(previewTicket),
    });
    expect(mocks.rpc).toHaveBeenCalledWith("revoke_bib_ticket", {
      p_ticket_hash: sha256(acceptedTicket),
    });
  });

  it("rejects cross-origin lookup, accept, rejection and link before storage access", async () => {
    const crossOrigin = { origin: "https://other.example", cookie: acceptedCookie };
    expect((await lookup(request("lookup", { eventId: 17, bib: "123" }, crossOrigin))).status).toBe(403);
    expect((await accept(request("accept", { ticket: previewTicket }, crossOrigin))).status).toBe(403);
    expect((await reject(request("accept", { ticket: previewTicket }, {
      ...crossOrigin, method: "DELETE",
    }))).status).toBe(403);
    expect((await link(request("link", {}, crossOrigin))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.requireConfirmedUser).not.toHaveBeenCalled();
  });

  it("rejects incorrect media types, nonnumeric editions and oversized lookups", async () => {
    expect((await lookup(request("lookup", { eventId: 17, bib: "123" }, {
      contentType: "text/plain",
    }))).status).toBe(400);
    expect((await lookup(request("lookup", { eventId: "17", bib: "123" }))).status).toBe(400);
    expect((await lookup(request("lookup", { eventId: 17, bib: "a".repeat(4096) }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires the acceptance cookie and ignores a ticket supplied in JSON", async () => {
    const response = await link(request("link", { acceptedTicket }));
    expect(response.status).toBe(409);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([[new AuthenticationError(), 401], [new UnconfirmedEmailError(), 403]])(
    "maps the session guard to HTTP %s before touching a ticket",
    async (error, status) => {
      mocks.requireConfirmedUser.mockRejectedValue(error);
      const response = await link(request("link", {}, { cookie: acceptedCookie }));
      expect(response.status).toBe(status);
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );

  it("links only for the verified user with the accepted cookie and clears it on success", async () => {
    mocks.rpc.mockImplementation(async (rpc: string) => ({
      error: null,
      data: rpc === "link_accepted_bib" ? runnerId : true,
    }));
    const response = await link(request("link", { userId: runnerId }, { cookie: acceptedCookie }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "linked" });
    expect(response.headers.get("set-cookie")).toMatch(/mw_bib_acceptance=;.*Max-Age=0/i);
    expect(mocks.rpc).toHaveBeenCalledWith("link_accepted_bib", {
      p_user_id: userId,
      p_ticket_hash: sha256(acceptedTicket),
    });
  });

  it("returns a generic refusal when the database declines to link the accepted result", async () => {
    mocks.rpc.mockImplementation(async (rpc: string) => ({
      error: null,
      data: rpc === "link_accepted_bib" ? null : true,
    }));
    const response = await link(request("link", undefined, { cookie: acceptedCookie }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "This BIB could not be linked to your account." });
  });

  it("keeps raw database errors out of the response", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "roster@example.test" } });
    const response = await lookup(request("lookup", { eventId: 17, bib: "00123" }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("roster@example.test");
  });

  it("submits only a normalized address and a hash to the reservation RPC", async () => {
    mocks.rpc.mockResolvedValue({ error: null, data: "reserved" });
    expect(await beginBibSignup(acceptedTicket, " Runner@Example.Test ")).toBe("reserved");
    expect(mocks.rpc).toHaveBeenCalledWith("begin_bib_signup", {
      p_ticket_hash: sha256(acceptedTicket),
      p_email: "runner@example.test",
    });
  });

  it("finalizes only under the supplied verified account identifier", async () => {
    mocks.rpc.mockResolvedValue({ error: null, data: [runnerId] });
    expect(await finalizeBibSignup(userId)).toEqual([runnerId]);
    expect(mocks.rpc).toHaveBeenCalledWith("finalize_bib_signup", { p_user_id: userId });
  });
});
