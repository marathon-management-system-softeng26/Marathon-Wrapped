import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  accessToken: vi.fn(),
  fetch: vi.fn(),
  from: vi.fn(),
  remove: vi.fn(),
  eq: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireUser: mocks.user,
  AuthenticationError: class extends Error {},
}));
vi.mock("@/lib/supabaseServer", () => ({
  getSupabaseAdmin: () => ({ from: mocks.from }),
}));
vi.mock("@/lib/strava/client", async original => ({
  ...await original<object>(),
  getUserStravaAccessToken: mocks.accessToken,
}));

import { POST } from "@/app/api/strava/disconnect/route";
import { decryptToken, encryptToken } from "@/lib/strava/client";

const request = () => new NextRequest("http://localhost/api/strava/disconnect", { method: "POST" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("STRAVA_ENCRYPTION_KEY", "01".repeat(32));
  vi.stubEnv("STRAVA_CLIENT_ID", "test-client");
  vi.stubEnv("STRAVA_CLIENT_SECRET", "test-secret");
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.user.mockResolvedValue({ id: "verified-user" });
  mocks.accessToken.mockResolvedValue("test-token+&=");
  mocks.fetch.mockResolvedValue(new Response(null, { status: 200 }));
  mocks.from.mockReturnValue({ delete: mocks.remove });
  mocks.remove.mockReturnValue({ eq: mocks.eq });
  mocks.eq.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Strava token encryption", () => {
  it("round-trips a token with the full GCM tag and IV", async () => {
    const encrypted = await encryptToken("synthetic-strava-token");
    expect(await decryptToken(encrypted)).toBe("synthetic-strava-token");
  });

  it("rejects tampered ciphertext", async () => {
    const encrypted = await encryptToken("synthetic-strava-token");
    const tampered = (encrypted[0] === "0" ? "1" : "0") + encrypted.slice(1);
    await expect(decryptToken(tampered)).rejects.toThrow();
  });
});

describe("Strava disconnect", () => {
  it("revokes with app credentials and a form token before deleting the user's connection", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.accessToken).toHaveBeenCalledWith("verified-user");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).toHaveBeenCalledWith("https://www.strava.com/oauth/revoke", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from("test-client:test-secret").toString("base64")}`,
      },
      body: expect.any(URLSearchParams),
    });
    const body = mocks.fetch.mock.calls[0][1].body as URLSearchParams;
    expect(body.get("token")).toBe("test-token+&=");
    expect(body.get("token_type_hint")).toBe("access_token");
    expect(mocks.from).toHaveBeenCalledWith("strava_connections");
    expect(mocks.eq).toHaveBeenCalledWith("user_id", "verified-user");
  });

  it("does not revoke or delete when app credentials are missing", async () => {
    vi.stubEnv("STRAVA_CLIENT_SECRET", "");

    expect((await POST(request())).status).toBe(500);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("keeps the connection when provider revocation fails", async () => {
    mocks.fetch.mockResolvedValue(new Response(null, { status: 503 }));

    expect((await POST(request())).status).toBe(500);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
