import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: mocks.user, AuthenticationError: class extends Error {} }));
vi.mock("@/lib/supabaseServer", () => ({ getSupabaseAdmin: () => ({ from: mocks.from, rpc: mocks.rpc }) }));

// Exercise both HTTP handlers and the real processing service; only auth/storage are external doubles.
import { GET, PUT } from "@/app/api/runners/[runnerId]/strava/route";
import { POST as disconnect } from "@/app/api/strava/disconnect/route";
import { AuthenticationError } from "@/lib/auth/session";

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
const context = (runner = runnerId) => ({ params: Promise.resolve({ runnerId: runner }) });
const request = (method = "GET", body?: unknown, requestOrigin = origin) => new Request(`${origin}/api/runners/${runnerId}/strava`, {
  method, headers: { Origin: requestOrigin, "Content-Type": "application/json" },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});
const detail = (id = "10", gps = true): Row => ({
  id, athleteId: "123", sportType: "Run", startDate: "2027-08-17T00:15:00Z", distanceMeters: 5000,
  startLatLng: gps ? [-6.234567, 106.876543] : null,
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
  storageError = null; selectionCalls = []; selectionOutcome = "selected"; revokeOutcome = "done"; beforeRead = undefined;
  tables = {
    runner_access: [{ user_id: "user", runner_id: runnerId }],
    strava_connections: [{ user_id: "user", generation: "generation", status: "active", athlete_id: "123",
      access_token: "private-token", refresh_token: null, credentials_uncertain: false }],
    strava_activity_candidates: [], strava_activities: [], strava_runner_activities: [], strava_live_metrics: [], strava_jobs: [],
  };
  mocks.from.mockImplementation((table: string) => {
    const filters: ((row: Row) => boolean)[] = [];
    const result = () => {
      beforeRead?.(table);
      return { data: structuredClone((tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)))), error: storageError };
    };
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return query; },
      in: (key: string, values: unknown[]) => { filters.push((row) => values.includes(row[key])); return query; },
      neq: (key: string, value: unknown) => { filters.push((row) => row[key] !== value); return query; },
      order: () => query,
      maybeSingle: async () => { const value = result(); return { ...value, data: value.data[0] ?? null }; },
      then: (resolve: (value: unknown) => void) => Promise.resolve(result()).then(resolve),
    };
    return query;
  });
  mocks.rpc.mockImplementation(async (name: string, args: Row) => {
    if (name === "strava_confirm_runner_activity") {
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
afterEach(() => vi.unstubAllEnvs());

describe("runner Strava access and safe states", () => {
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
    if (kind !== "unknown") candidate();
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
  it.each([["obsolete", 409], ["forbidden", 404], ["invalid_candidate", 409], ["private-payload", 503]])("maps atomic selection result %s safely", async (outcome, status) => {
    candidate(); selectionOutcome = outcome as string;
    await safe(await PUT(request("PUT", { activityId: "10" }), context()), status as number);
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
