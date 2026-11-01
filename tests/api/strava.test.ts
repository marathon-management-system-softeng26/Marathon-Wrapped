import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHash } from "node:crypto";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  access: vi.fn(),
  rpc: vi.fn(),
  fetch: vi.fn(),
  disconnect: vi.fn(),
  enqueue: vi.fn(),
  process: vi.fn(),
  connection: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireUser: mocks.user,
  AuthenticationError: class extends Error {},
}));

vi.mock("@/lib/auth/access", async (original) => ({
  ...await original<object>(),
  requireRunnerAccess: mocks.access,
}));

vi.mock("@/lib/strava/store", () => ({ stravaRpc: mocks.rpc }));

vi.mock("@/lib/supabaseServer", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: mocks.connection }),
      }),
    }),
  }),
}));

vi.mock("@/lib/strava/processing", async (original) => ({
  ...await original<object>(),
  disconnectStravaUser: mocks.disconnect,
  enqueueWebhookEvent: mocks.enqueue,
  processStravaJobs: mocks.process,
}));

import { POST as connect, DELETE as cancel } from "@/app/api/strava/connect/route";
import { GET as callback } from "@/app/api/strava/callback/route";
import { POST as disconnect } from "@/app/api/strava/disconnect/route";
import {
  GET as verifyWebhook,
  POST as webhook,
} from "@/app/api/strava/webhook/route";
import { POST as worker } from "@/app/api/internal/strava/process/route";
import { AccessDeniedError } from "@/lib/auth/access";
import { decryptToken, encryptToken } from "@/lib/strava/client";

const origin = "http://localhost";
const runnerId = "11111111-1111-1111-1111-111111111111";
const otherRunnerId = "22222222-2222-2222-2222-222222222222";
const returnPath = `/wrapped/${runnerId}`;
const claimedAttempt = (status = "claimed", runner = runnerId) => ({
  status,
  runner_id: runner,
  return_path: `/wrapped/${runner}`,
  generation: "33333333-3333-3333-3333-333333333333",
});
const state = "01".repeat(32);
const cookieName = (value: string) =>
  "strava_oauth_" + createHash("sha256").update(value).digest("hex");

const request = (
  path: string,
  method = "POST",
  headers: Record<string, string> = {},
  body?: string,
) =>
  new NextRequest(`${origin}/api/${path}`, {
    method,
    headers: { Origin: origin, ...headers },
    body,
  });

const connectRequest = (runner = runnerId, extra = "") =>
  request("strava/connect", "POST", { "Content-Type": "application/x-www-form-urlencoded" },
    `runnerId=${encodeURIComponent(runner)}${extra}`);

const callbackRequest = (
  query = `code=code&scope=read,activity:read_all&state=${state}`,
  cookie = state,
) =>
  request(`strava/callback?${query}`, "GET", { Cookie: `${cookieName(state)}=${cookie}` });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("STRAVA_ENCRYPTION_KEY", "01".repeat(32));
  vi.stubEnv("STRAVA_CLIENT_ID", "test-client");
  vi.stubEnv("STRAVA_CLIENT_SECRET", "test-secret");
  vi.stubEnv("STRAVA_CALLBACK_URL", `${origin}/api/strava/callback`);
  vi.stubEnv("STRAVA_WEBHOOK_VERIFY_TOKEN", "verify-secret");
  vi.stubEnv("STRAVA_PROCESS_SECRET", "worker-secret");
  vi.stubGlobal("fetch", mocks.fetch);

  mocks.access.mockResolvedValue(undefined);
  mocks.user.mockResolvedValue({ id: "verified-user" });
  mocks.disconnect.mockResolvedValue("disconnected");
  mocks.connection.mockResolvedValue({ data: null });
  mocks.rpc.mockImplementation(async (name, args) =>
    name === "strava_begin_runner_oauth"
      ? "ready"
      : name === "strava_claim_runner_oauth"
        ? claimedAttempt()
        : args?.p_tokens
          ? "connected"
          : args?.p_outcome ?? "failed",
  );
  mocks.fetch.mockResolvedValue(
    Response.json({
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      athlete: { id: 123 },
    }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Strava encryption", () => {
  it("round-trips and rejects tampering", async () => {
    const encrypted = await encryptToken("synthetic-token");

    expect(await decryptToken(encrypted)).toBe("synthetic-token");
    await expect(
      decryptToken((encrypted[0] === "0" ? "1" : "0") + encrypted.slice(1)),
    ).rejects.toThrow();
  });

  it("rejects malformed encryption configuration and ciphertext", async () => {
    vi.stubEnv("STRAVA_ENCRYPTION_KEY", "not-hex");

    await expect(encryptToken("token")).rejects.toThrow();
    await expect(decryptToken("aa")).rejects.toThrow();
  });
});

describe("Strava OAuth", () => {
  it("binds a random state to the selected authorized runner and HttpOnly browser cookie", async () => {
    const response = await connect(connectRequest());

    expect(response.status).toBe(303);

    const location = new URL(response.headers.get("location")!);

    expect(location.origin).toBe("https://www.strava.com");

    const generated = location.searchParams.get("state")!;

    expect(generated).toMatch(/^[a-f0-9]{64}$/);
    expect(mocks.access).toHaveBeenCalledWith("verified-user", runnerId);
    expect(mocks.rpc).toHaveBeenCalledWith("strava_begin_runner_oauth", {
      p_runner: runnerId,
      p_return_path: returnPath,
      p_user: "verified-user",
      p_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(response.headers.get("set-cookie")).toContain(
      `${cookieName(generated)}=${generated}`,
    );
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toMatch(/samesite=lax/i);
  });

  it("rejects a foreign runner before storing an attempt", async () => {
    mocks.access.mockRejectedValue(new AccessDeniedError());

    const response = await connect(connectRequest(otherRunnerId));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "runner_not_found" });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it.each(["", "not-a-uuid", "../foreign", "11111111-1111-1111-1111-11111111111Z"])(
    "rejects malformed runner ID %s before access checks or storage", async (runner) => {
      const response = await connect(connectRequest(runner));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_runner" });
      expect(mocks.access).not.toHaveBeenCalled();
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );

  it("rejects missing or duplicated runner form fields", async () => {
    expect((await connect(request("strava/connect"))).status).toBe(400);
    expect((await connect(connectRequest(runnerId, `&runnerId=${otherRunnerId}`))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("does not create an attempt when access verification is unavailable", async () => {
    mocks.access.mockRejectedValue(new Error("Access verification unavailable"));

    expect((await connect(connectRequest())).status).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("stores only a server-generated local return path", async () => {
    await connect(connectRequest(runnerId, "&returnPath=https%3A%2F%2Fevil.example&return_path=%2F%2Fevil.example"));

    expect(mocks.rpc).toHaveBeenCalledWith("strava_begin_runner_oauth", {
      p_user: "verified-user",
      p_runner: runnerId,
      p_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      p_return_path: "/wrapped/11111111-1111-1111-1111-111111111111",
    });
  });

  it("keeps the selected recap when a user owns two runners", async () => {
    await connect(connectRequest(otherRunnerId));
    expect(mocks.access).toHaveBeenCalledWith("verified-user", otherRunnerId);
    expect(mocks.rpc).toHaveBeenCalledWith("strava_begin_runner_oauth", expect.objectContaining({
      p_runner: otherRunnerId,
      p_return_path: "/wrapped/22222222-2222-2222-2222-222222222222",
    }));
    const normal = mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation((name, args) => name === "strava_claim_runner_oauth"
      ? Promise.resolve(claimedAttempt("claimed", otherRunnerId)) : normal(name, args));

    const response = await callback(callbackRequest(
      `code=code&scope=activity:read_all&state=${state}&runnerId=${runnerId}&returnPath=https://evil.example`,
    ));

    expect(response.headers.get("location")).toBe(
      `${origin}/wrapped/22222222-2222-2222-2222-222222222222?strava=connected`,
    );
    expect(mocks.rpc).toHaveBeenCalledWith("strava_claim_runner_oauth", {
      p_user: "verified-user", p_hash: createHash("sha256").update(state).digest("hex"),
    });
  });

  it.each(["https://evil.example", "//evil.example", `/wrapped/${otherRunnerId}`])(
    "rejects mismatched stored callback path %s before exchanging", async (path) => {
      mocks.rpc.mockResolvedValue({ ...claimedAttempt(), return_path: path });

      expect((await callback(callbackRequest())).status).toBe(400);
      expect(mocks.fetch).not.toHaveBeenCalled();
    },
  );

  it("cannot recover a runner from callback parameters when stored context is missing", async () => {
    mocks.rpc.mockResolvedValue({ status: "invalid_state", runner_id: null, return_path: null, generation: null });

    const response = await callback(callbackRequest(`code=code&scope=activity:read_all&state=${state}&runnerId=${runnerId}`));

    expect(response.headers.get("location")).toBe(`${origin}/?strava=invalid_state`);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("maps unexpected storage outcomes to a safe feedback code", async () => {
    mocks.rpc.mockResolvedValue(claimedAttempt("sensitive-storage-detail"));

    const response = await callback(callbackRequest());

    expect(response.headers.get("location")).toBe(`${origin}${returnPath}?strava=authorization_failed`);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("does not exchange again when a successful callback is replayed", async () => {
    const normal = mocks.rpc.getMockImplementation()!;
    let claims = 0;
    mocks.rpc.mockImplementation((name, args) => name === "strava_claim_runner_oauth"
      ? Promise.resolve(claimedAttempt(++claims === 1 ? "claimed" : "connected")) : normal(name, args));

    const first = await callback(callbackRequest());
    const repeated = await callback(callbackRequest());

    expect(first.headers.get("location")).toBe(`${origin}${returnPath}?strava=connected`);
    expect(repeated.headers.get("location")).toBe(`${origin}${returnPath}?strava=connected`);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.calls.filter(([name]) => name === "strava_finish_oauth")).toHaveLength(1);
  });

  it("rejects cross-origin starts before touching auth or storage", async () => {
    expect(
      (await connect(
        request("strava/connect", "POST", { Origin: "https://evil.example" }),
      )).status,
    ).toBe(403);
    expect(mocks.user).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("does not start OAuth when already connected", async () => {
    mocks.rpc.mockResolvedValue("already_connected");

    const response = await connect(connectRequest());

    expect(response.headers.get("location")).toBe(`${origin}${returnPath}?strava=already_connected`);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("rejects missing configuration before creating an attempt", async () => {
    vi.stubEnv("STRAVA_CLIENT_SECRET", "");

    expect((await connect(connectRequest())).status).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("exchanges once, persists encrypted credentials, and strips OAuth parameters", async () => {
    const response = await callback(callbackRequest());

    expect(response.headers.get("location")).toBe(`${origin}${returnPath}?strava=connected`);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);

    const saved = mocks.rpc.mock.calls.find(
      ([name]) => name === "strava_finish_oauth",
    )![1];

    expect(saved.p_user).toBe("verified-user");
    expect(saved.p_tokens.athlete_id).toBe("123");
    expect(saved.p_tokens.scopes).toContain("activity:read_all");
    expect(await decryptToken(saved.p_tokens.access_token)).toBe("access-token");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it.each(["expired", "cancelled", "processing", "connected", "invalid_state"])(
    "does not exchange a %s callback",
    async (status) => {
      mocks.rpc.mockResolvedValue(claimedAttempt(status));

      await callback(callbackRequest());

      expect(mocks.fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    `code=x&scope=activity:read_all`,
    `code=x&scope=activity:read_all&state=${state}&state=${state}`,
  ])("rejects missing or duplicated state", async (query) => {
    expect((await callback(callbackRequest(query))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects a callback moved to another browser", async () => {
    expect(
      (await callback(callbackRequest(undefined, "02".repeat(32)))).status,
    ).toBe(400);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("handles provider denial without exchanging or replacing a connection", async () => {
    const response = await callback(
      callbackRequest(`error=access_denied&state=${state}`),
    );

    expect(response.headers.get("location")).toBe(`${origin}${returnPath}?strava=cancelled`);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("rejects partial consent before exchanging", async () => {
    const response = await callback(callbackRequest(`code=x&scope=read&state=${state}`));

    expect(response.headers.get("location")).toBe(`${origin}${returnPath}?strava=insufficient_scope`);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("retries persistence without reusing the code", async () => {
    const normal = mocks.rpc.getMockImplementation()!;
    let saves = 0;

    mocks.rpc.mockImplementation(async (name, args) => {
      if (name === "strava_finish_oauth" && args.p_tokens && ++saves === 1) {
        throw new Error("storage");
      }

      return normal(name, args);
    });

    expect((await callback(callbackRequest())).headers.get("location")).toContain("connected");
    expect(saves).toBe(2);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("does not retry a timed-out code exchange", async () => {
    mocks.fetch.mockRejectedValue(new Error("timeout"));

    expect((await callback(callbackRequest())).headers.get("location")).toContain(
      "provider_unavailable",
    );
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("cancels only the current browser's attempt", async () => {
    await cancel(
      request("strava/connect", "DELETE", {
        Cookie: `${cookieName(state)}=${state}`,
      }),
    );

    expect(mocks.rpc).toHaveBeenCalledWith("strava_cancel_oauth", {
      p_user: "verified-user",
      p_hash: expect.any(String),
    });
  });

  it("does not erase a newer attempt's binding when an old callback finishes", async () => {
    const newer = "02".repeat(32);
    const response = await callback(
      request(
        `strava/callback?code=x&scope=activity:read_all&state=${state}`,
        "GET",
        { Cookie: `${cookieName(state)}=${state}; ${cookieName(newer)}=${newer}` },
      ),
    );

    expect(response.headers.get("set-cookie")).toContain(cookieName(state));
    expect(response.headers.get("set-cookie")).not.toContain(cookieName(newer));
  });

  it("reports a completed connection rather than pretending cancellation removed it", async () => {
    mocks.connection.mockResolvedValue({ data: { status: "active" } });

    expect(await (await cancel(request("strava/connect", "DELETE"))).json()).toEqual({
      status: "connected",
    });
  });
});

describe("Strava disconnect and worker endpoints", () => {
  it("delegates disconnect to the lifecycle service", async () => {
    expect((await disconnect(request("strava/disconnect"))).status).toBe(200);
    expect(mocks.disconnect).toHaveBeenCalledWith("verified-user");
  });

  it("reports pending provider cleanup without claiming revocation succeeded", async () => {
    mocks.disconnect.mockResolvedValue("disconnecting");

    expect((await disconnect(request("strava/disconnect"))).status).toBe(202);
  });

  it("rejects cross-origin disconnects", async () => {
    expect(
      (await disconnect(
        request("strava/disconnect", "POST", { Origin: "https://evil.example" }),
      )).status,
    ).toBe(403);
    expect(mocks.disconnect).not.toHaveBeenCalled();
  });

  it("requires scheduler credentials before processing", async () => {
    expect((await worker(request("internal/strava/process"))).status).toBe(401);
    expect(mocks.process).not.toHaveBeenCalled();
    expect(
      (await worker(
        request("internal/strava/process", "POST", {
          Authorization: "Bearer worker-secret",
        }),
      )).status,
    ).toBe(200);
  });
});

describe("Strava webhooks", () => {
  const event = {
    object_type: "activity",
    object_id: 1,
    owner_id: 2,
    subscription_id: 3,
    aspect_type: "create",
    event_time: 1000,
  };

  it("verifies only the configured subscription challenge", async () => {
    const response = await verifyWebhook(
      request(
        "strava/webhook?hub.mode=subscribe&hub.verify_token=verify-secret&hub.challenge=challenge",
        "GET",
      ),
    );

    expect(await response.json()).toEqual({ "hub.challenge": "challenge" });
    expect(
      (await verifyWebhook(
        request(
          "strava/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=challenge",
          "GET",
        ),
      )).status,
    ).toBe(403);
  });

  it("acknowledges only durable enqueue success", async () => {
    expect(
      (await webhook(request("strava/webhook", "POST", {}, JSON.stringify(event)))).status,
    ).toBe(200);

    mocks.enqueue.mockRejectedValue(new Error("storage"));
    expect(
      (await webhook(request("strava/webhook", "POST", {}, JSON.stringify(event)))).status,
    ).toBe(503);
  });

  it("rejects malformed and oversized payloads", async () => {
    expect((await webhook(request("strava/webhook", "POST", {}, "{}"))).status).toBe(400);
    expect(
      (await webhook(request("strava/webhook", "POST", {}, " ".repeat(16385)))).status,
    ).toBe(413);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});
