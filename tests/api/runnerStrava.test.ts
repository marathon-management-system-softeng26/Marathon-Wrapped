import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: mocks.user, AuthenticationError: class extends Error {} }));
vi.mock("@/lib/supabaseServer", () => ({ getSupabaseAdmin: () => ({ from: mocks.from, rpc: mocks.rpc }) }));

// Exercise both HTTP handlers and the real processing service; only auth/storage are external doubles.
import { GET, PUT } from "@/app/api/runners/[runnerId]/strava/route";
import { POST as disconnect } from "@/app/api/strava/disconnect/route";
import { AuthenticationError } from "@/lib/auth/session";
import { getRunnerEnrichment } from "@/controllers/enrichmentController";
import { encryptToken } from "@/lib/strava/client";
import { getRunnerStravaRoute } from "@/lib/strava/processing";
import * as processing from "@/lib/strava/processing";
import { routeToStrava, stravaViewModel } from "@/lib/strava/viewModel";

const runnerId = "11111111-1111-1111-1111-111111111111";
const otherRunner = "22222222-2222-2222-2222-222222222222";
const origin = "http://localhost";
type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let selectionCalls: Row[];
let storageError: string | null;
let selectionOutcome: string;
let revokeOutcome: "done" | "busy" | "uncertain" | "retry";
let beforeRead: ((table: string) => void) | undefined;
let querySignals: AbortSignal[];
const context = (runner = runnerId) => ({ params: Promise.resolve({ runnerId: runner }) });
const request = (method = "GET", body?: unknown, requestOrigin = origin) => new Request(`${origin}/api/runners/${runnerId}/strava`, {
  method, headers: { Origin: requestOrigin, "Content-Type": "application/json" },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});
const detail = (id = "10", gps = true): Row => ({
  id, athleteId: "123", sportType: "Run", startDate: "2027-08-17T00:15:00Z", distanceMeters: 5000,
  gpsAvailable: gps,
  averageHeartrate: 145.5, maxHeartrate: null, elevationGainMeters: 0, calories: null, averageCadence: 80.5,
  polyline: "private-polyline", raw: "private-payload", access_token: "private-token",
});
function candidate(id = "10", match = "auto_match", gps = true, overrides: Row = {}) {
  tables.strava_activities.push({ user_id: "user", generation: "generation", activity_id: id, activity: detail(id, gps) });
  tables.strava_activity_candidates.push({ user_id: "user", generation: "generation", runner_id: runnerId,
    activity_id: id, match_status: match, reason: gps ? "race_checks_passed" : "missing_start_location",
    summary: { raw: "private-summary", polyline: "private-polyline" }, ...overrides });
}
function selected(id = "10") {
  tables.strava_runner_activities.push({ user_id: "user", generation: "generation", runner_id: runnerId, activity_id: id, selection_source: "auto" });
  tables.strava_live_metrics.push({ user_id: "user", generation: "generation", runner_id: runnerId, activity_id: id,
    avg_heartrate: 145.5, max_heartrate: null, elevation_gain_m: 0, calories: null, avg_cadence: 80.5,
    raw: "private-metric", polyline: "private-polyline" });
}
async function safe(response: Response, status = 200) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const text = await response.text();
  for (const secret of ["polyline", "token", "raw", "payload", "startLatLng", "-6.234567", "106.876543", "athleteId", "generation", "user_id"]) {
    expect(text).not.toContain(secret);
  }
  return JSON.parse(text);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("STRAVA_CALLBACK_URL", `${origin}/api/strava/callback`);
  mocks.user.mockResolvedValue({ id: "user" });
  storageError = null; selectionCalls = []; selectionOutcome = "selected"; revokeOutcome = "done"; beforeRead = undefined; querySignals = [];
  tables = {
    runner_access: [{ user_id: "user", runner_id: runnerId }],
    strava_oauth_attempts: [{ user_id: "user", generation: "generation", runner_id: runnerId, status: "connected" }],
    strava_runner_attachments: [{ user_id: "user", generation: "generation", runner_id: runnerId, status: "active", created_at: "first", attachment_id: "first" }],
    strava_connections: [{ user_id: "user", generation: "generation", status: "active", athlete_id: "123",
      access_token: "private-token", refresh_token: null, credentials_uncertain: false, granted_scopes: ["activity:read_all"] }],
    strava_activity_candidates: [], strava_activities: [], strava_runner_activities: [], strava_live_metrics: [], strava_jobs: [],
  };
  mocks.from.mockImplementation((table: string) => {
    const filters: ((row: Row) => boolean)[] = [];
    let offset = 0;
    let count = 1000;
    let orderBy: string | undefined;
    const result = () => {
      beforeRead?.(table);
      const rows = (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
      if (orderBy) rows.sort((a, b) => String(a[orderBy!]).localeCompare(String(b[orderBy!])));
      return { data: structuredClone(rows.slice(offset, offset + Math.min(count, 1000))), error: storageError };
    };
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return query; },
      in: (key: string, values: unknown[]) => { filters.push((row) => values.includes(row[key])); return query; },
      neq: (key: string, value: unknown) => { filters.push((row) => row[key] !== value); return query; },
      order: (key: string) => { orderBy = key; return query; },
      range: (from: number, to: number) => { offset = from; count = to - from + 1; return query; },
      abortSignal: (signal: AbortSignal) => { querySignals.push(signal); return query; },
      maybeSingle: async () => { const value = result(); return { ...value, data: value.data[0] ?? null }; },
      then: (resolve: (value: unknown) => void) => Promise.resolve(result()).then(resolve),
    };
    return query;
  });
  mocks.rpc.mockImplementation(async (name: string, args: Row) => {
    if (name === "strava_attach_runner") {
      if (!tables.runner_access.some((row) => row.user_id === args.p_user && row.runner_id === args.p_runner)) return { data: "forbidden" };
      if (tables.strava_connections[0]?.status !== "active") return { data: "connection_required" };
      if (!tables.strava_runner_attachments.some((row) => row.runner_id === args.p_runner)) {
        tables.strava_runner_attachments.push({ user_id: args.p_user, runner_id: args.p_runner, generation: "generation", status: "active", created_at: "second", attachment_id: "second" });
      }
      return { data: "attached" };
    }
    if (name === "strava_detach_runner") {
      for (const table of ["strava_runner_attachments", "strava_activity_candidates", "strava_runner_activities", "strava_live_metrics", "strava_wrapped_snapshots"]) {
        tables[table] = (tables[table] ?? []).filter((row) => row.runner_id !== args.p_runner);
      }
      return { data: "detached" };
    }
    if (name === "strava_confirm_runner_activity_and_project") {
      selectionCalls.push(args);
      if (selectionOutcome === "selected") {
        tables.strava_runner_activities = [{ user_id: args.p_user, generation: args.p_generation, runner_id: args.p_runner, activity_id: args.p_activity }];
        const stored = tables.strava_activities.find((row) => row.activity_id === args.p_activity)?.activity as Row;
        tables.strava_live_metrics = [{ ...tables.strava_runner_activities[0], avg_heartrate: stored.averageHeartrate,
          max_heartrate: stored.maxHeartrate, elevation_gain_m: stored.elevationGainMeters, calories: stored.calories, avg_cadence: stored.averageCadence }];
      }
      return { data: selectionOutcome };
    }
    if (name === "strava_disconnect") { tables.strava_connections[0].status = "disconnecting"; }
    if (name === "strava_claim_credentials") {
      if (revokeOutcome === "retry") throw new Error("private-provider-payload");
      return { data: revokeOutcome === "busy" ? { busy: true } : { ...tables.strava_connections[0], credentials_uncertain: revokeOutcome === "uncertain" } };
    }
    if (name === "strava_finish_disconnect") { tables.strava_connections[0].status = "disconnected"; return { data: true }; }
    return { data: true };
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("runner Strava access and safe states", () => {
  it("uses durable attachments after callback history is removed", async () => {
    candidate(); selected(); tables.strava_oauth_attempts = [];
    expect((await safe(await GET(request(), context()))).status).toBe("matched");
  });
  it("attaches a second owned runner without replacing the first or its connection", async () => {
    tables.runner_access.push({ user_id: "user", runner_id: otherRunner });
    const result = await processing.attachRunnerToStrava("user", otherRunner);
    expect(result.status).toBe("no_match");
    expect(tables.strava_runner_attachments.map((row) => row.runner_id)).toEqual([runnerId, otherRunner]);
    expect(tables.strava_connections[0].generation).toBe("generation");
  });
  it("requires OAuth before the first attachment", async () => {
    tables.strava_connections = [];
    await expect(processing.attachRunnerToStrava("user", runnerId)).rejects.toMatchObject({ code: "not_connected", status: 409 });
  });
  it("does not reuse an active connection with incomplete consent", async () => {
    tables.strava_connections[0].granted_scopes = ["activity:read"];
    await expect(processing.attachRunnerToStrava("user", runnerId)).rejects.toMatchObject({ code: "not_connected", status: 409 });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not mark this runner unavailable because another attachment's import failed", async () => {
    tables.strava_jobs = [{ user_id: "user", generation: "generation", kind: "backfill", status: "failed", payload: { runner_id: otherRunner } }];
    expect((await safe(await GET(request(), context()))).status).toBe("no_match");
  });
  it.each(["foreign", "organizer"])("denies %s attachment and detach without direct ownership", async (user) => {
    await expect(processing.attachRunnerToStrava(user, runnerId)).rejects.toMatchObject({ code: "runner_not_found" });
    await expect(processing.detachRunnerFromStrava(user, runnerId)).rejects.toMatchObject({ code: "runner_not_found" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("detaches only the requested runner and preserves the other snapshot", async () => {
    tables.runner_access.push({ user_id: "user", runner_id: otherRunner });
    tables.strava_runner_attachments.push({ user_id: "user", generation: "generation", runner_id: otherRunner, status: "active", created_at: "second", attachment_id: "second" });
    tables.strava_wrapped_snapshots = [{ runner_id: runnerId }, { runner_id: otherRunner }];
    expect(await processing.detachRunnerFromStrava("user", runnerId)).toBe("detached");
    expect(tables.strava_wrapped_snapshots).toEqual([{ runner_id: otherRunner }]);
    expect(tables.strava_connections[0].status).toBe("active");
    expect((await safe(await GET(request(), context()))).status).toBe("disconnected");
  });
  it.each(["detached", "reattached"])("suppresses loaded metrics when %s during the read", async (change) => {
    candidate(); selected();
    beforeRead = (table) => {
      if (table === "strava_live_metrics") {
        if (change === "detached") tables.strava_runner_attachments = [];
        else tables.strava_runner_attachments[0].attachment_id = "replacement";
      }
    };
    const result = await safe(await GET(request(), context()));
    expect(result.activityId).toBeNull(); expect(result.metrics).toEqual({});
  });
  it("uses selected live metrics ahead of demo without changing photo data", async () => {
    candidate(); selected();
    tables.strava_metrics = [{ runner_id: runnerId, data_source: "demo", avg_heartrate: 999, avg_cadence: 180 }];
    tables.fotoyu_photos = [{ id: "photo", bib_number: "A1001", photo_url: "/photos/demo-race.jpg" }];
    const result = await getRunnerEnrichment(runnerId, "A1001", new AbortController().signal, "user");
    expect(result.strava).toMatchObject({ state: "connected", metrics: { avg_heartrate: 145.5, max_heartrate: null, elevation_gain_m: 0, calories: null, avg_cadence: 80.5 } });
    expect(result.photos).toHaveLength(1);
  });
  it("restores labeled demo metrics after disconnect and ignores unselected live rows", async () => {
    candidate(); selected();
    tables.strava_metrics = [{ runner_id: runnerId, data_source: "demo", avg_heartrate: 155 }];
    tables.strava_runner_activities = [];
    let result = await getRunnerEnrichment(runnerId, null, new AbortController().signal, "user");
    expect(result.strava.state).toBe("needs_confirmation"); expect(result.strava.metrics).toBeNull();
    tables.strava_connections[0].status = "disconnected";
    result = await getRunnerEnrichment(runnerId, null, new AbortController().signal, "user");
    expect(result.strava).toMatchObject({ state: "demo", metrics: { avg_heartrate: 155, max_heartrate: null } });
  });
  it("never gives live health metrics to organizer-only baseline viewers", async () => {
    candidate(); selected();
    tables.strava_metrics = [{ runner_id: runnerId, data_source: "demo", avg_heartrate: 155 }];
    const result = await getRunnerEnrichment(runnerId, null, new AbortController().signal, "organizer");
    expect(result.strava.state).toBe("demo"); expect(result.strava.metrics?.avg_heartrate).toBe(155);
    expect(result.strava.controlsAvailable).toBe(false);
    expect(JSON.stringify(result)).not.toContain("145.5");
  });
  it("never relabels legacy live metrics as organizer-visible demo data", async () => {
    tables.strava_metrics = [{ runner_id: runnerId, data_source: "strava", avg_heartrate: 188, avg_cadence: 91 }];
    const result = await getRunnerEnrichment(runnerId, null, new AbortController().signal, "organizer");
    expect(result.strava).toMatchObject({ state: "disconnected", metrics: null, controlsAvailable: false });
    expect(JSON.stringify(result)).not.toMatch(/188|91/);
  });
  it("hides every organizer control when the sample query also fails", async () => {
    beforeRead = (table) => { storageError = table === "strava_metrics" ? "storage unavailable" : null; };
    const result = await getRunnerEnrichment(runnerId, null, new AbortController().signal, "organizer");
    expect(result.strava).toMatchObject({ state: "unavailable", controlsAvailable: false });
    expect(stravaViewModel(result.strava, runnerId).actions).toEqual([]);
    expect(stravaViewModel(result.strava, runnerId).candidates).toEqual([]);
  });
  it("hides mutation controls until direct ownership can be established", async () => {
    storageError = "access unavailable";
    const result = await getRunnerEnrichment(runnerId, null, new AbortController().signal, "user");
    expect(result.strava.controlsAvailable).toBe(false);
  });
  it("reports unavailable and a warning for storage failure without leaking internals", async () => {
    storageError = "private-token";
    const result = await getRunnerEnrichment(runnerId, null, new AbortController().signal, "user");
    expect(result.strava).toMatchObject({ state: "unavailable", metrics: null });
    expect(result.warnings.length).toBeGreaterThan(0); expect(JSON.stringify(result)).not.toContain("private-token");
  });
  it("reports disconnected when neither live nor demo data exists", async () => {
    tables.strava_connections = [];
    expect((await getRunnerEnrichment(runnerId, null, new AbortController().signal, "user")).strava).toMatchObject({ state: "disconnected", metrics: null });
  });
  it.each(["other_runner", "old_generation", "pending"])("does not expose or confirm data outside the completed runner scope: %s", async (kind) => {
    candidate(); selected();
    tables.runner_access.push({ user_id: "user", runner_id: otherRunner });
    if (kind === "other_runner") tables.strava_runner_attachments[0].runner_id = otherRunner;
    if (kind === "old_generation") tables.strava_runner_attachments[0].generation = "old";
    if (kind === "pending") tables.strava_runner_attachments = [];
    expect(await safe(await GET(request(), context()))).toEqual({ status: "disconnected", activityId: null, candidates: [], metrics: {} });
    await safe(await PUT(request("PUT", { activityId: "10" }), context()), 409);
    expect(selectionCalls).toEqual([]);
  });
  it("does not substitute samples when current provider import has failed", async () => {
    tables.strava_metrics = [{ runner_id: runnerId, data_source: "demo", avg_heartrate: 155 }];
    tables.strava_jobs.push({ user_id: "user", generation: "generation", kind: "activity", status: "failed" });
    const result = await getRunnerEnrichment(runnerId, null, new AbortController().signal, "user");
    expect(result.strava).toMatchObject({ state: "unavailable", metrics: null });
    expect(result.warnings).toHaveLength(1);
  });
  it("passes the optional-data abort signal to every live storage read", async () => {
    candidate(); selected();
    const signal = new AbortController().signal;
    await getRunnerStravaRoute("user", runnerId, signal);
    expect(querySignals.length).toBe(10);
    expect(querySignals.every((value) => value === signal)).toBe(true);
  });
  it.each(["GET", "PUT"])("requires authentication for %s", async (method) => {
    mocks.user.mockRejectedValue(new AuthenticationError());
    expect(await safe(await (method === "GET" ? GET(request(), context()) : PUT(request("PUT", { activityId: "10" }), context())), 401)).toEqual({ error: "sign_in_required" });
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it.each(["GET", "PUT"])("conceals foreign runner data for %s", async (method) => {
    candidate();
    await safe(await (method === "GET" ? GET(request(), context(otherRunner)) : PUT(request("PUT", { activityId: "10" }), context(otherRunner))), 404);
    expect(selectionCalls).toHaveLength(0);
  });
  it("rejects malformed runner IDs before reading storage", async () => {
    await safe(await GET(request(), context("not-a-uuid")), 400);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it.each([null, "disconnected", "disconnecting", "reauth_required"])("reports connection state %s without exposing stale candidates", async (status) => {
    candidate(); selected();
    if (status === null) tables.strava_connections = [];
    else tables.strava_connections[0].status = status;
    expect(await safe(await GET(request(), context()))).toEqual({ status: status ?? "disconnected", activityId: null, candidates: [], metrics: {} });
  });
  it("reports reauthorization needed to complete uncertain cleanup", async () => {
    Object.assign(tables.strava_connections[0], { status: "disconnecting", credentials_uncertain: true });
    expect((await safe(await GET(request(), context()))).status).toBe("reauthorize_to_disconnect");
  });
  it("reports importing while current discovery is pending", async () => {
    tables.strava_jobs.push({ user_id: "user", generation: "generation", kind: "backfill", status: "pending" });
    expect((await safe(await GET(request(), context()))).status).toBe("importing");
  });
  it("reports unavailable for failed current discovery without leaking its error", async () => {
    tables.strava_jobs.push({ user_id: "user", generation: "generation", kind: "activity", status: "failed", last_error: "private-payload" });
    expect((await safe(await GET(request(), context()))).status).toBe("unavailable");
  });
  it("reports no match when discovery finished and ignores obsolete or foreign jobs", async () => {
    tables.strava_jobs.push({ user_id: "other", generation: "generation", kind: "activity", status: "pending" },
      { user_id: "user", generation: "old", kind: "backfill", status: "pending" });
    candidate("10", "no_match");
    expect(await safe(await GET(request(), context()))).toEqual({ status: "no_match", activityId: null, candidates: [], metrics: {} });
  });
  it("exposes a single selected auto-match with safe summaries and partial metrics", async () => {
    candidate(); selected();
    expect(await safe(await GET(request(), context()))).toEqual({ status: "matched", activityId: "10", candidates: [{
      activityId: "10", startTimeLocal: "2027-08-17T07:15:00+07:00", distanceMeters: 5000, sportType: "Run", gpsAvailable: true, matchReason: "race_checks_passed",
    }], metrics: { avg_heartrate: 145.5, elevation_gain_m: 0, avg_cadence: 80.5 } });
  });
  it.each(["GET", "PUT"])("keeps the race detail beyond 1000 unrelated activities in %s", async (method) => {
    for (let i = 0; i < 1005; i++) {
      tables.strava_activities.push({ user_id: "user", generation: "generation", activity_id: String(10000 + i), activity: detail(String(10000 + i)) });
    }
    candidate(); selected();
    const response = method === "GET" ? await GET(request(), context()) : await PUT(request("PUT", { activityId: "10" }), context());
    const body = await safe(response);
    expect(body.status).toBe("matched"); expect(body.activityId).toBe("10");
    expect(body.candidates).toHaveLength(1); expect(body.candidates[0].activityId).toBe("10");
    expect(body.metrics).toEqual({ avg_heartrate: 145.5, elevation_gain_m: 0, avg_cadence: 80.5 });
  });
  it("retains candidates and selected metrics beyond the candidate response cap", async () => {
    for (let i = 0; i < 1005; i++) candidate(String(10000 + i));
    selected("11004");
    const body = await safe(await GET(request(), context()));
    expect(body.status).toBe("matched"); expect(body.activityId).toBe("11004");
    expect(body.candidates).toHaveLength(1005);
    expect(body.metrics).toEqual({ avg_heartrate: 145.5, elevation_gain_m: 0, avg_cadence: 80.5 });
  });
  it("offers ambiguous candidates for confirmation without attaching metrics", async () => {
    candidate(); candidate("11");
    const body = await safe(await GET(request(), context()));
    expect(body.status).toBe("needs_confirmation"); expect(body.activityId).toBeNull(); expect(body.candidates).toHaveLength(2); expect(body.metrics).toEqual({});
  });
  it("offers missing GPS for explicit confirmation", async () => {
    candidate("10", "needs_confirmation", false);
    const body = await safe(await GET(request(), context()));
    expect(body.status).toBe("needs_confirmation"); expect(body.candidates[0].gpsAvailable).toBe(false);
  });
  it("shows fresh scoped discovery details and GPS warnings with an older shared activity", async () => {
    vi.stubEnv("STRAVA_ENCRYPTION_KEY", "01".repeat(32));
    Object.assign(tables.strava_connections[0], {
      access_token: await encryptToken("provider-access"), expires_at: new Date(Date.now() + 300_000).toISOString(),
    });
    tables.strava_activities.push({ user_id: "user", generation: "generation", activity_id: "10", activity: detail() });
    tables.runners = [{ id: runnerId, category_id: 7 }];
    tables.categories = [{ id: 7, distance_km: 5 }];
    tables.strava_race_configs = [{
      category_id: 7, start_time_from: "2027-08-17T00:00:00Z", start_time_to: "2027-08-17T02:00:00Z",
      start_latitude: -6.2, start_longitude: 106.8, start_radius_m: 100, allowed_sport_types: ["Run"],
    }];
    const fetchActivity = vi.fn().mockResolvedValue(Response.json({
      id: 10, athlete: { id: 123 }, sport_type: "Run", start_date: "2027-08-17T01:05:00Z",
      distance: 5240, moving_time: 1600, elapsed_time: 1660, start_latlng: [],
      map: { polyline: "private-polyline" },
    }));
    vi.stubGlobal("fetch", fetchActivity);
    const defaultRpc = mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async (name: string, args: Row) => {
      if (name === "strava_claim_projection_aware_job") return { data: {
        id: "job", lease_id: "lease", user_id: "user", generation: "generation", kind: "activity", attempts: 1,
        attachment_fences: { [runnerId]: "first" }, payload: { runner_id: runnerId, object_id: "10", owner_id: "123" },
      } };
      if (name === "strava_commit_runner_job") {
        const [batch] = args.p_runner_candidates as { runner_id: string; candidates: Row[] }[];
        // The real SQL preserves the shared row on a scoped job and commits this candidate.
        tables.strava_activity_candidates.push(...batch.candidates.map((candidateRow) => ({
          user_id: "user", generation: "generation", runner_id: batch.runner_id, ...candidateRow,
        })));
        return { data: true };
      }
      return defaultRpc(name, args);
    });

    await processing.processStravaJobs(1);

    expect(fetchActivity).toHaveBeenCalledTimes(1);
    expect(tables.strava_activities[0].activity).toMatchObject({
      startDate: "2027-08-17T00:15:00Z", distanceMeters: 5000, gpsAvailable: true,
    });
    const expected = {
      activityId: "10", startTimeLocal: "2027-08-17T08:05:00+07:00", distanceMeters: 5240,
      sportType: "Run", gpsAvailable: false, matchReason: "missing_start_location",
    };
    const body = await safe(await GET(request(), context()));
    expect(body).toEqual({ status: "needs_confirmation", activityId: null, candidates: [expected], metrics: {} });
    expect(stravaViewModel(routeToStrava(body), runnerId).candidates).toEqual([{
      activityId: "10", label: "17 Aug 2027, 08:05 WIB · 5.24 km",
      note: "GPS is unavailable. Confirm this is your race activity.",
    }]);
    expect(tables.strava_activity_candidates[0].summary).toEqual({
      startDate: "2027-08-17T01:05:00.000Z", distanceMeters: 5240, gpsAvailable: false,
    });

    const confirmed = await safe(await PUT(request("PUT", { activityId: "10" }), context()));
    expect(confirmed.status).toBe("matched");
    expect(confirmed.candidates).toEqual([expected]);
  });
  it("keeps the missing GPS warning for an older candidate with no summary", async () => {
    candidate("10", "needs_confirmation", true, { reason: "missing_start_location", summary: {} });
    const body = await safe(await GET(request(), context()));

    expect(body.candidates).toEqual([{
      activityId: "10", startTimeLocal: "2027-08-17T07:15:00+07:00", distanceMeters: 5000,
      sportType: "Run", gpsAvailable: false, matchReason: "missing_start_location",
    }]);
  });
  it.each(["disconnected", "reconnected"])("hides an earlier generation if %s during the read", async (change) => {
    candidate(); selected();
    beforeRead = (table) => {
      if (table !== "strava_live_metrics") return;
      if (change === "disconnected") tables.strava_connections[0].status = "disconnected";
      else tables.strava_connections[0].generation = "replacement";
    };
    expect(await safe(await GET(request(), context()))).toEqual({ status: change === "disconnected" ? "disconnected" : "importing", activityId: null, candidates: [], metrics: {} });
  });
  it("does not expose unrecognized reasons or invalid metric values", async () => {
    candidate("10", "auto_match", true, { reason: "private-token" }); selected();
    Object.assign(tables.strava_live_metrics[0], { avg_heartrate: -1, max_heartrate: Infinity, elevation_gain_m: NaN, calories: "100" });
    const body = await safe(await GET(request(), context()));
    expect(body.candidates[0].matchReason).toBe("confirmation_required");
    expect(body.metrics).toEqual({ avg_cadence: 80.5 });
  });
  it("ignores obsolete, foreign and other-runner candidates and metrics", async () => {
    candidate("10", "auto_match", true, { generation: "old" });
    candidate("11", "auto_match", true, { user_id: "other" });
    candidate("12", "auto_match", true, { runner_id: otherRunner });
    selected(); tables.strava_runner_activities[0].generation = "old";
    expect(await safe(await GET(request(), context()))).toEqual({ status: "no_match", activityId: null, candidates: [], metrics: {} });
  });
  it("returns a private unavailable error for storage failure", async () => {
    storageError = "private-token";
    expect(await safe(await GET(request(), context()), 503)).toEqual({ error: "temporarily_unavailable" });
  });
});

describe("runner Strava confirmation", () => {
  it("confirms a missing-GPS candidate using stored metrics and repeats idempotently", async () => {
    candidate("10", "needs_confirmation", false);
    const first = await safe(await PUT(request("PUT", { activityId: "10", metrics: { calories: 9999 }, userId: "other" }), context()));
    const repeated = await safe(await PUT(request("PUT", { activityId: "10" }), context()));
    expect(first).toEqual(repeated); expect(first.status).toBe("matched"); expect(first.activityId).toBe("10");
    expect(first.metrics).toEqual({ avg_heartrate: 145.5, elevation_gain_m: 0, avg_cadence: 80.5 });
    expect(tables.strava_runner_activities).toHaveLength(1);
    expect(selectionCalls[0]).toEqual({ p_user: "user", p_generation: "generation", p_runner: runnerId, p_activity: "10" });
  });
  it.each([{}, { activityId: 10 }, { activityId: "" }, { activityId: "../10" }, null, []])("rejects malformed confirmation %j", async (body) => {
    await safe(await PUT(request("PUT", body), context()), 400); expect(selectionCalls).toHaveLength(0);
  });
  it("rejects invalid JSON privately", async () => {
    await safe(await PUT(new Request(`${origin}/api/runners/${runnerId}/strava`, { method: "PUT", headers: { Origin: origin }, body: "{" }), context()), 400);
  });
  it.each(["https://evil.example", "null", ""])("rejects origin %s before auth or storage", async (value) => {
    await safe(await PUT(request("PUT", { activityId: "10" }, value), context()), 403);
    expect(mocks.user).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled();
  });
  it.each(["unknown", "foreign", "runner", "stale", "no_match", "missing_detail", "wrong_athlete"])("rejects %s activity without selection", async (kind) => {
    if (kind !== "unknown") candidate("10", "auto_match", true, {
      summary: { startDate: "2027-08-17T00:15:00Z", distanceMeters: 5000, gpsAvailable: true },
    });
    if (kind === "foreign") tables.strava_activity_candidates[0].user_id = "other";
    if (kind === "runner") tables.strava_activity_candidates[0].runner_id = otherRunner;
    if (kind === "stale") tables.strava_activity_candidates[0].generation = "old";
    if (kind === "no_match") tables.strava_activity_candidates[0].match_status = "no_match";
    if (kind === "missing_detail") tables.strava_activities = [];
    if (kind === "wrong_athlete") (tables.strava_activities[0].activity as Row).athleteId = "456";
    await safe(await PUT(request("PUT", { activityId: "10" }), context()), 409);
    expect(selectionCalls).toHaveLength(0);
  });
  it.each(["disconnected", "disconnecting", "reauth_required"])("rejects confirmation for %s connection", async (status) => {
    candidate(); tables.strava_connections[0].status = status;
    await safe(await PUT(request("PUT", { activityId: "10" }), context()), 409); expect(selectionCalls).toHaveLength(0);
  });
  it.each([["obsolete", 409], ["forbidden", 404], ["invalid_candidate", 409], ["activity_already_selected", 409], ["private-payload", 503]])("maps atomic selection result %s safely", async (outcome, status) => {
    candidate(); selectionOutcome = outcome as string;
    const body = await safe(await PUT(request("PUT", { activityId: "10" }), context()), status as number);
    if (outcome === "activity_already_selected") expect(body).toEqual({ error: "activity_already_selected" });
  });
});

describe("disconnect outcomes", () => {
  it.each([["done", "disconnected", 200], ["busy", "disconnecting", 202], ["retry", "disconnecting", 202], ["uncertain", "reauthorize_to_disconnect", 409]])(
    "reports %s cleanup truthfully", async (outcome, status, http) => {
      revokeOutcome = outcome as typeof revokeOutcome;
      expect(await safe(await disconnect(request("POST")), http as number)).toEqual({ status });
    },
  );
});

describe("runner attachment HTTP boundaries", () => {
  const handler = async (action: "attach" | "detach") => action === "attach"
    ? (await import("@/app/api/runners/[runnerId]/strava/attach/route")).POST
    : (await import("@/app/api/runners/[runnerId]/strava/detach/route")).POST;
  it.each(["attach", "detach"] as const)("%s rejects cross-origin requests before authentication", async (action) => {
    await safe(await (await handler(action))(request("POST", undefined, "https://evil.example"), context()), 403);
    expect(mocks.user).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["attach", "detach"] as const)("%s requires the verified session", async (action) => {
    mocks.user.mockRejectedValue(new AuthenticationError());
    await safe(await (await handler(action))(request("POST"), context()), 401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["attach", "detach"] as const)("%s conceals unowned and organizer-only runners", async (action) => {
    tables.organizer_access = [{ user_id: "user", event_id: 1 }];
    await safe(await (await handler(action))(request("POST"), context(otherRunner)), 404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["attach", "detach"] as const)("%s ignores body identities and uses asynchronous route params", async (action) => {
    const body = await safe(await (await handler(action))(request("POST", { userId: "other", athleteId: "456", runnerId: otherRunner }), context()));
    expect(body.status).toBe(action === "attach" ? "no_match" : "detached");
    expect(mocks.rpc).toHaveBeenCalledWith(`strava_${action}_runner`, { p_user: "user", p_runner: runnerId });
  });
});
