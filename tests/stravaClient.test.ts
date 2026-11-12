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
  moving_time: 300,
  elapsed_time: 320,
  start_latlng: [],
  map: { summary_polyline: "summary" },
};

const metricSplit = {
  split: 1,
  distance: 1001.5,
  moving_time: 290,
  elapsed_time: 300,
  average_speed: 3.453,
  elevation_difference: -3,
  pace_zone: 1,
};

const detailedRun = {
  id: 1,
  athlete: { id: 2, resource_state: 1 },
  resource_state: 3,
  name: "Evening Run",
  description: "Private note",
  sport_type: "Run",
  start_date: "2026-10-28T17:00:00+07:00",
  start_date_local: "2026-10-28T17:00:00Z",
  timezone: "(GMT+07:00) Asia/Jakarta",
  distance: 2050.4,
  moving_time: 610,
  elapsed_time: 645,
  average_speed: 3.361,
  max_speed: 5.75,
  average_heartrate: 151.5,
  max_heartrate: 184,
  total_elevation_gain: 21.7,
  calories: 182,
  average_cadence: 86.4,
  start_latlng: [-6.2, 106.8],
  end_latlng: [-6.21, 106.81],
  map: { id: "a1", polyline: "private-route", summary_polyline: "summary" },
  embed_token: "private-token",
  splits_metric: [
    { split: 2, distance: 999.9, moving_time: 305, elapsed_time: 330, elevation_difference: 4, pace_zone: 1 },
    metricSplit,
    { split: 3, distance: 49, moving_time: 15, elapsed_time: 15, average_speed: 3.267, elevation_difference: 0, pace_zone: 1 },
  ],
  splits_standard: [metricSplit],
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

  it("uses project-fenced credential operations for a legacy refetch", async () => {
    const row = { user_id: "u", status: "active", generation: "g", operation_id: "op",
      expires_at: "2020-01-01T00:00:00Z", refresh_token: await encryptToken("refresh") };
    mocks.connection.mockResolvedValue({ data: row });
    mocks.rpc.mockImplementation(async (name) => name === "strava_claim_project_credentials" ? row : false);
    mocks.fetch.mockResolvedValue(new Response("", { status: 401 }));
    await expect(getUserStravaAccessToken("u", false, { job: "j", lease: "l" })).rejects.toThrow();
    expect(mocks.rpc).toHaveBeenCalledWith("strava_claim_project_credentials", expect.objectContaining({ p_job: "j", p_lease: "l" }));
    expect(mocks.rpc).toHaveBeenCalledWith("strava_finish_project_refresh_v2", expect.objectContaining({ p_job: "j", p_lease: "l", p_reauth: true }));
    expect(mocks.rpc).not.toHaveBeenCalledWith("strava_finish_refresh", expect.anything());
  });

  it("defers an invalid project refresh-token terminal transition to the fenced worker", async () => {
    const row = { user_id: "u", status: "active", generation: "g", operation_id: "op", expires_at: "2020-01-01T00:00:00Z", refresh_token: await encryptToken("refresh") };
    mocks.connection.mockResolvedValue({ data: row });
    mocks.rpc.mockImplementation(async (name) => name === "strava_claim_project_credentials" ? row : true);
    mocks.fetch.mockResolvedValue(Response.json({ errors: [{ resource: "RefreshToken", code: "invalid" }] }, { status: 400 }));
    await expect(getUserStravaAccessToken("u", false, { job: "j", lease: "l" })).rejects.toMatchObject({ code: "authorization_revoked" });
    expect(mocks.rpc).toHaveBeenCalledWith("strava_finish_project_refresh_v2", expect.objectContaining({ p_reauth: false, p_revoked: true, p_job: "j", p_lease: "l" }));
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

    const activity = await getStravaActivity("access", "1", "2");

    expect(activity).toMatchObject({
      id: "1",
      athleteId: "2",
      startLatLng: null,
    });
    expect(activity).not.toHaveProperty("polyline");
    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://www.strava.com/api/v3/activities/1",
      expect.objectContaining({ cache: "no-store", redirect: "error" }),
    );
  });

  it("normalizes detailed race metrics and preserves raw average cadence", async () => {
    mocks.fetch.mockResolvedValue(
      Response.json({
        ...rawActivity,
        average_heartrate: 151.5,
        max_heartrate: 184,
        total_elevation_gain: 321.7,
        calories: 702,
        average_cadence: 86.4,
      }),
    );

    expect(await getStravaActivity("access", "1", "2")).toMatchObject({
      averageHeartrate: 151.5,
      maxHeartrate: 184,
      elevationGainMeters: 321.7,
      calories: 702,
      averageCadence: 86.4,
    });
  });

  it("normalizes the documented timing, speeds and sorted metric splits into an allowlisted record", async () => {
    mocks.fetch.mockResolvedValue(Response.json(detailedRun));

    expect(await getStravaActivity("access", "1", "2")).toEqual({
      id: "1",
      athleteId: "2",
      sportType: "Run",
      startDate: "2026-10-28T10:00:00.000Z",
      distanceMeters: 2050.4,
      startLatLng: [-6.2, 106.8],
      movingTimeSeconds: 610,
      elapsedTimeSeconds: 645,
      averageSpeedMps: 3.361,
      maxSpeedMps: 5.75,
      metricSplits: [
        { kilometer: 1, elapsedSeconds: 300, movingSeconds: 290, distanceMeters: 1001.5, averageSpeedMps: 3.453 },
        { kilometer: 2, elapsedSeconds: 330, movingSeconds: 305, distanceMeters: 999.9, averageSpeedMps: null },
        { kilometer: 3, elapsedSeconds: 15, movingSeconds: 15, distanceMeters: 49, averageSpeedMps: 3.267 },
      ],
      averageHeartrate: 151.5,
      maxHeartrate: 184,
      elevationGainMeters: 21.7,
      calories: 182,
      averageCadence: 86.4,
    });
  });

  it("keeps missing speed and splits absent on listed activities", async () => {
    mocks.fetch.mockResolvedValue(Response.json([rawActivity]));

    const [activity] = await listStravaActivities("access", 1, 2, 1, "2");
    expect(activity).toMatchObject({
      movingTimeSeconds: 300,
      elapsedTimeSeconds: 320,
      averageSpeedMps: null,
      maxSpeedMps: null,
      metricSplits: null,
    });
  });

  it("accepts explicit null for unavailable detail metrics and zero for recorded time and speed", async () => {
    mocks.fetch.mockResolvedValue(Response.json({
      ...rawActivity,
      distance: 0,
      moving_time: 0,
      elapsed_time: 0,
      average_speed: 0,
      max_speed: 0,
      average_heartrate: null,
      splits_metric: null,
    }));

    expect(await getStravaActivity("access", "1", "2")).toMatchObject({
      distanceMeters: 0,
      movingTimeSeconds: 0,
      elapsedTimeSeconds: 0,
      averageSpeedMps: 0,
      maxSpeedMps: 0,
      averageHeartrate: null,
      metricSplits: null,
    });
  });

  it.each([
    ["missing moving time", { moving_time: undefined }],
    ["string elapsed time", { elapsed_time: "645" }],
    ["NaN moving time", { moving_time: Number.NaN }],
    ["infinite elapsed time", { elapsed_time: Infinity }],
    ["negative moving time", { moving_time: -1 }],
    ["fractional elapsed time", { elapsed_time: 645.5 }],
    ["time above the signed integer bound", { elapsed_time: 2_147_483_648 }],
    ["elapsed time shorter than moving time", { elapsed_time: 609 }],
    ["negative distance", { distance: -1 }],
    ["infinite distance", { distance: Infinity }],
    ["string speed", { average_speed: "3.361" }],
    ["negative maximum speed", { max_speed: -1 }],
  ])("rejects %s in provider activity detail", async (_name, override) => {
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ ...detailedRun, ...override }) });

    await expect(getStravaActivity("access", "1", "2")).rejects.toMatchObject({ code: "invalid_provider_response" });
  });

  it.each([
    ["non-array splits", {}],
    ["duplicate markers", [metricSplit, metricSplit]],
    ["zero marker", [{ ...metricSplit, split: 0 }]],
    ["fractional marker", [{ ...metricSplit, split: 1.5 }]],
    ["missing time", [{ ...metricSplit, moving_time: undefined }]],
    ["string time", [{ ...metricSplit, elapsed_time: "300" }]],
    ["fractional time", [{ ...metricSplit, moving_time: 290.5 }]],
    ["negative time", [{ ...metricSplit, moving_time: -1 }]],
    ["impossible timing", [{ ...metricSplit, elapsed_time: 289 }]],
    ["zero elapsed time with distance", [{ ...metricSplit, moving_time: 0, elapsed_time: 0 }]],
    ["negative distance", [{ ...metricSplit, distance: -1 }]],
    ["NaN distance", [{ ...metricSplit, distance: Number.NaN }]],
    ["distance spanning two kilometer markers", [{ ...metricSplit, distance: 2000 }]],
    ["infinite speed", [{ ...metricSplit, average_speed: Infinity }]],
    ["excessive split count", Array.from({ length: 257 }, (_, index) => ({ ...metricSplit, split: index + 1 }))],
  ])("rejects %s in provider metric splits", async (_name, splits) => {
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ ...detailedRun, splits_metric: splits }) });

    await expect(getStravaActivity("access", "1", "2")).rejects.toMatchObject({ code: "invalid_provider_response" });
  });

  it.each([
    ["average_heartrate", "averageHeartrate"],
    ["max_heartrate", "maxHeartrate"],
    ["total_elevation_gain", "elevationGainMeters"],
    ["calories", "calories"],
    ["average_cadence", "averageCadence"],
  ])("leaves missing %s as null", async (providerField, normalizedField) => {
    const activity = {
      ...rawActivity,
      average_heartrate: 151,
      max_heartrate: 184,
      total_elevation_gain: 321,
      calories: 702,
      average_cadence: 86,
    };
    Reflect.deleteProperty(activity, providerField);
    mocks.fetch.mockResolvedValue(Response.json(activity));

    expect(await getStravaActivity("access", "1", "2")).toHaveProperty(
      normalizedField,
      null,
    );
  });

  it("preserves valid zero-valued metrics", async () => {
    mocks.fetch.mockResolvedValue(
      Response.json({
        ...rawActivity,
        average_heartrate: 0,
        max_heartrate: 0,
        total_elevation_gain: 0,
        calories: 0,
        average_cadence: 0,
      }),
    );

    expect(await getStravaActivity("access", "1", "2")).toMatchObject({
      averageHeartrate: 0,
      maxHeartrate: 0,
      elevationGainMeters: 0,
      calories: 0,
      averageCadence: 0,
    });
  });

  it.each([
    ["average_heartrate", -1],
    ["max_heartrate", Number.POSITIVE_INFINITY],
    ["total_elevation_gain", -0.1],
    ["calories", "702"],
    ["average_cadence", Number.NaN],
  ])("rejects malformed present metric %s", async (field, value) => {
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ...rawActivity, [field]: value }),
    } as Response);

    await expect(getStravaActivity("access", "1", "2")).rejects.toMatchObject({
      code: "invalid_provider_response",
    });
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
