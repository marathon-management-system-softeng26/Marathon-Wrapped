import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ signUp: vi.fn(), signOut: vi.fn(), rpc: vi.fn() }));

vi.mock("@/lib/supabaseServer", () => ({
  getSupabaseAdmin: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/supabaseSession", () => ({
  createSupabaseSession: async () => ({
    auth: { signUp: mocks.signUp, signOut: mocks.signOut },
  }),
}));

import { POST as register } from "@/app/api/auth/register/route";

const ticket = "b".repeat(43);
const credentials = { email: "new@example.test", password: "password-123" };

function request(body: unknown, options: { origin?: string; cookie?: string } = {}) {
  const headers = new Headers({
    Origin: options.origin ?? "http://localhost",
    "Content-Type": "application/json",
  });
  if (options.cookie !== "") headers.set("Cookie", options.cookie ?? "mw_bib_acceptance=" + ticket);
  return new Request("http://localhost/api/auth/register", {
    method: "POST", headers, body: JSON.stringify(body),
  });
}

describe("registration HTTP boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.signUp.mockResolvedValue({
      data: { user: { id: "new-user" }, session: null },
      error: null,
    });
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.rpc.mockImplementation(async (rpc: string) => {
      if (rpc === "consume_bib_rate_limit") return { data: true, error: null };
      if (rpc === "begin_bib_signup") return { data: "reserved", error: null };
      throw new Error("Unexpected RPC " + rpc);
    });
  });

  it("reserves the accepted BIB before creating the account with normalized credentials", async () => {
    const response = await register(request({ ...credentials, email: " New@Example.Test " }));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true, requiresEmailConfirmation: true });
    expect(mocks.signUp).toHaveBeenCalledWith(credentials);
    expect(mocks.rpc.mock.calls.map(([rpc]) => rpc)).toEqual([
      "consume_bib_rate_limit", "begin_bib_signup",
    ]);
    expect(mocks.rpc.mock.invocationCallOrder[1]).toBeLessThan(mocks.signUp.mock.invocationCallOrder[0]);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("refuses direct signup even when the body supplies a ticket and BIB", async () => {
    const response = await register(request({
      ...credentials, acceptedTicket: ticket, bib: "00123",
    }, { cookie: "" }));
    expect(response.status).toBe(409);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it("blocks cross-origin registration before authentication", async () => {
    const response = await register(request(credentials, { origin: "https://other.example" }));
    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it.each([
    { email: "new@example.test", password: "short" },
    { email: "not-an-address", password: "password-123" },
    { email: "new@example.test", password: "a".repeat(8192) },
  ])("rejects malformed or oversized credentials", async (body) => {
    expect((await register(request(body))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it("treats unavailable reservations uniformly and stops before Auth", async () => {
    mocks.rpc.mockImplementation(async (rpc: string) => ({
      data: rpc === "consume_bib_rate_limit" ? true : "unavailable",
      error: null,
    }));
    const response = await register(request(credentials));
    expect(response.status).toBe(409);
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it("rate-limits account submissions before attempting a reservation", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    const response = await register(request(credentials));
    expect(response.status).toBe(429);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it("reuses the same reservation when Auth reports a duplicate submission", async () => {
    mocks.signUp.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { code: "user_already_exists", status: 422 },
    });
    const first = await register(request(credentials));
    const second = await register(request(credentials));
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await first.json()).toEqual(await second.json());
    const reservations = mocks.rpc.mock.calls.filter(([rpc]) => rpc === "begin_bib_signup");
    expect(reservations).toHaveLength(2);
    expect(reservations[0]).toEqual(reservations[1]);
  });

  it("does not grant access when signup unexpectedly returns a session", async () => {
    mocks.signUp.mockResolvedValue({
      data: { user: { id: "new-user" }, session: { access_token: "token" } },
      error: null,
    });
    const response = await register(request(credentials));
    expect(response.status).toBe(503);
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mocks.rpc.mock.calls.map(([rpc]) => rpc)).toEqual([
      "consume_bib_rate_limit", "begin_bib_signup",
    ]);
  });

  it("redacts Auth provider errors", async () => {
    mocks.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "private provider detail", status: 400 },
    });
    const response = await register(request(credentials));
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("private provider detail");
  });
});
