import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  rpc: vi.fn(),
  connection: vi.fn(),
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

import {
  decryptToken,
  encryptToken,
  getStravaActivity,
  getUserStravaAccessToken,
  listStravaActivities,
  revokeStravaAccess,
} from "@/lib/strava/client";

const rawActivity = {
  id: 1,
  athlete: { id: 2 },
  sport_type: "Run",
  start_date: "2026-10-28T10:00:00Z",
  distance: 1000,
  start_latlng: [],
  map: { summary_polyline: "summary" },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("STRAVA_ENCRYPTION_KEY", "01".repeat(32));
  vi.stubEnv("STRAVA_CLIENT_ID", "client");
  vi.stubEnv("STRAVA_CLIENT_SECRET", "secret");
  vi.stubGlobal("fetch", mocks.fetch);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Strava client", () => {
  it("refreshes with plaintext, saves both encrypted tokens, and returns plaintext", async () => {
    const row = {
      user_id: "u",
      status: "active",
      generation: "g",
      operation_id: "operation",
      expires_at: "2020-01-01T00:00:00Z",
      access_token: await encryptToken("old-access"),
      refresh_token: await encryptToken("old-refresh"),
    };

    mocks.connection.mockResolvedValue({ data: row, error: null });
    mocks.rpc.mockImplementation(async (name) =>
      name === "strava_claim_credentials" ? row : true,
    );
    mocks.fetch.mockResolvedValue(
      Response.json({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      }),
    );

    expect(await getUserStravaAccessToken("u")).toBe("new-access");
    expect(
      (mocks.fetch.mock.calls[0][1].body as URLSearchParams).get("refresh_token"),
    ).toBe("old-refresh");

    const saved = mocks.rpc.mock.calls[1][1];

    expect(await decryptToken(saved.p_tokens.access_token)).toBe("new-access");
    expect(await decryptToken(saved.p_tokens.refresh_token)).toBe("new-refresh");
    expect(saved.p_generation).toBe("g");
  });

  it("does not return a refreshed token when disconnect wins", async () => {
    const row = {
      user_id: "u",
      status: "active",
      generation: "g",
      operation_id: "op",
      refresh_token: await encryptToken("refresh"),
    };

    mocks.connection.mockResolvedValue({ data: row });
    mocks.rpc.mockImplementation(async (name) =>
      name === "strava_claim_credentials" ? row : false,
    );
    mocks.fetch.mockResolvedValue(
      Response.json({
        access_token: "access",
        refresh_token: "refresh2",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      }),
    );

    expect(await getUserStravaAccessToken("u")).toBeNull();
  });

  it("does not refresh concurrently when another operation owns the connection", async () => {
    mocks.connection.mockResolvedValue({ data: { status: "active" } });
    mocks.rpc.mockResolvedValue({ busy: true });

    await expect(getUserStravaAccessToken("u")).rejects.toMatchObject({
      code: "connection_busy",
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("requires reauthorization after an uncertain refresh response", async () => {
    const row = {
      user_id: "u",
      status: "active",
      generation: "g",
      operation_id: "op",
      refresh_token: await encryptToken("refresh"),
    };

    mocks.connection.mockResolvedValue({ data: row });
    mocks.rpc.mockResolvedValue(row);
    mocks.fetch.mockRejectedValue(new Error("response lost"));

    await expect(getUserStravaAccessToken("u")).rejects.toMatchObject({
      code: "provider_unavailable",
    });
    expect(mocks.rpc).toHaveBeenLastCalledWith(
      "strava_finish_refresh",
      expect.objectContaining({ p_reauth: true }),
    );
  });

  it("returns null only for disconnected users, not storage errors", async () => {
    mocks.connection
      .mockResolvedValueOnce({ data: null })
      .mockResolvedValueOnce({ error: {} });

    expect(await getUserStravaAccessToken("u")).toBeNull();
    await expect(getUserStravaAccessToken("u")).rejects.toThrow("storage");
  });

  it("normalizes missing GPS and uses private uncached requests", async () => {
    mocks.fetch.mockResolvedValue(Response.json(rawActivity));

    expect(await getStravaActivity("access", "1", "2")).toMatchObject({
      id: "1",
      athleteId: "2",
      startLatLng: null,
      polyline: "summary",
    });
    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://www.strava.com/api/v3/activities/1",
      expect.objectContaining({ cache: "no-store", redirect: "error" }),
    );
  });

  it("rejects foreign ownership and malformed GPS", async () => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json(rawActivity))
      .mockResolvedValueOnce(Response.json({ ...rawActivity, start_latlng: [91, 0] }));

    await expect(getStravaActivity("access", "1", "3")).rejects.toMatchObject({
      code: "athlete_mismatch",
    });
    await expect(getStravaActivity("access", "1", "2")).rejects.toMatchObject({
      code: "invalid_provider_response",
    });
  });

  it("accepts empty pagination but rejects invalid windows and unsafe IDs", async () => {
    mocks.fetch.mockResolvedValue(Response.json([]));

    expect(await listStravaActivities("access", 1, 2)).toEqual([]);
    await expect(listStravaActivities("access", 2, 1)).rejects.toMatchObject({
      code: "invalid_window",
    });
    await expect(getStravaActivity("access", "../athlete")).rejects.toMatchObject({
      code: "invalid_id",
    });
  });

  it("distinguishes absence, scope failure, and rate limiting", async () => {
    mocks.fetch
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(
        new Response(null, { status: 429, headers: { "Retry-After": "1000" } }),
      );

    await expect(getStravaActivity("access", "1")).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(getStravaActivity("access", "1")).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(getStravaActivity("access", "1")).rejects.toMatchObject({
      code: "rate_limited",
      retryAfter: 1000,
    });
  });

  it("revokes a refresh token with app credentials and accepts an empty success body", async () => {
    mocks.fetch.mockResolvedValue(new Response(null, { status: 200 }));

    await revokeStravaAccess("refresh+&=");

    const [url, init] = mocks.fetch.mock.calls[0];

    expect(url).toBe("https://www.strava.com/oauth/revoke");
    expect(init.body.get("token")).toBe("refresh+&=");
    expect(init.body.get("token_type_hint")).toBe("refresh_token");
    expect(init.headers.Authorization).toBe(
      `Basic ${Buffer.from("client:secret").toString("base64")}`,
    );
  });
});
