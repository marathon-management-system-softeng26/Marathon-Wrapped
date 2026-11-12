import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  connection: vi.fn(),
  access: vi.fn(),
  activity: vi.fn(),
  list: vi.fn(),
  verify: vi.fn(),
  revoke: vi.fn(),
  owner: vi.fn(),
  rows: vi.fn(),
}));

vi.mock("@/lib/strava/store", async (original) => ({ ...await original<object>(), stravaRpc: mocks.rpc }));

vi.mock("@/lib/supabaseServer", () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters[key] = value; return query; },
        maybeSingle: () => table === "strava_connections" ? mocks.owner() : mocks.rows(table, filters, true),
        then: (resolve: (value: unknown) => void) => Promise.resolve(mocks.rows(table, filters, false)).then(resolve),
      };
      return query;
    },
  }),
}));

vi.mock("@/lib/strava/client", async (original) => ({
  ...await original<object>(),
  loadStravaConnection: mocks.connection,
  getUserStravaAccessToken: mocks.access,
  getStravaActivity: mocks.activity,
  listStravaActivities: mocks.list,
  verifyStravaAuthorization: mocks.verify,
  revokeStravaAccess: mocks.revoke,
}));

import { encryptToken, StravaError } from "@/lib/strava/client";
import * as projection from "@/lib/strava/projection";
import {
  disconnectStravaUser,
  enqueueStravaBackfill,
  enqueueRunnerStravaBackfill,
  enqueueWebhookEvent,
  processStravaJobs,
} from "@/lib/strava/processing";

const connection = {
  user_id: "user",
  athlete_id: "2",
  status: "active",
  generation: "generation",
};

const event = {
  object_type: "activity",
  object_id: 1,
  aspect_type: "update",
  owner_id: 2,
  subscription_id: 3,
  event_time: 1000,
} as const;

const job = {
  id: "job",
  user_id: "user",
  generation: "generation",
  kind: "webhook",
  lease_id: "lease",
  attempts: 1,
  payload: event,
  attachment_fences: { "11111111-1111-1111-1111-111111111111": "first" },
};

const runnerId = "11111111-1111-1111-1111-111111111111";
const otherRunner = "22222222-2222-2222-2222-222222222222";
const raceMetrics = {
  id: "1", athleteId: "2", sportType: "Run", startDate: "2027-08-17T01:00:00Z",
  distanceMeters: 5000, movingTimeSeconds: 1480, elapsedTimeSeconds: 1520,
  averageSpeedMps: 3.378, maxSpeedMps: 4.4, metricSplits: null, averageHeartrate: 145.5,
  maxHeartrate: null, elevationGainMeters: 0, calories: null, averageCadence: 80.5,
};
const raceActivity = { ...raceMetrics, startLatLng: [-6.2, 106.8] };
const storedRaceActivity = { ...raceMetrics, gpsAvailable: true };
const raceConfig = {
  category_id: 7, start_time_from: "2027-08-17T00:00:00Z", start_time_to: "2027-08-17T02:00:00Z",
  start_latitude: -6.2, start_longitude: 106.8, start_radius_m: 100,
  allowed_sport_types: ["Run"], distance_tolerance_m: 500,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("STRAVA_ENCRYPTION_KEY", "01".repeat(32));
  vi.stubEnv("STRAVA_SUBSCRIPTION_ID", "3");
  mocks.connection.mockResolvedValue(connection);
  mocks.access.mockResolvedValue("access");
  mocks.activity.mockResolvedValue(raceActivity);
  mocks.owner.mockResolvedValue({ data: { user_id: "user", generation: "generation" } });
  mocks.rows.mockImplementation(async (table, filters, single) => {
    const rows: Record<string, unknown> = {
      strava_oauth_attempts: { runner_id: runnerId }, strava_runner_attachments: { runner_id: runnerId, created_at: "first", attachment_id: "first" }, runner_access: { runner_id: runnerId },
      runners: { category_id: 7 }, categories: { distance_km: 5 }, strava_race_configs: raceConfig,
    };
    return { data: single ? rows[table] : [rows[table]] };
  });
  mocks.rpc.mockImplementation(async (name) =>
    name === "strava_claim_projection_aware_job" ? null : true,
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const claim = (value: Record<string, unknown> = job) => {
  let claimed = false;

  mocks.rpc.mockImplementation(async (name) =>
    name === "strava_projection_context" ? [{ runner_id: runnerId, distance_km: 5, race: raceConfig }] :
    name === "strava_claim_projection_aware_job"
      ? claimed
        ? null
        : (claimed = true, value)
      : true,
  );
};

describe("Strava processing", () => {
  it("refetches legacy selected detail before committing a projection", async () => {
    const normal = mocks.rows.getMockImplementation()!;
    mocks.rows.mockImplementation((table, filters, single) => {
      if (table === "strava_runner_activities") return Promise.resolve({ data: { activity_id: "1" } });
      if (table === "strava_activities") return Promise.resolve({ data: { activity: { ...storedRaceActivity, movingTimeSeconds: undefined } } });
      if (table === "runners") return Promise.resolve({ data: { category_id: 7, name: "Runner", bib_number: "12" } });
      if (table === "categories") return Promise.resolve({ data: { distance_km: 5, name: "5K", event_id: 8 } });
      if (table === "events") return Promise.resolve({ data: { name: "Race", event_date: "2027-08-17" } });
      return normal(table, filters, single);
    });
    claim({ ...job, kind: "project", payload: { runner_id: runnerId, activity_id: "1", build_id: "build", version: 1 } });

    await processStravaJobs();

    expect(mocks.activity).toHaveBeenCalledWith("access", "1", "2");
    expect(mocks.rpc).toHaveBeenCalledWith("strava_commit_projection_refresh_fenced", expect.objectContaining({
      p_job: "job", p_lease: "lease", p_activities: [{ id: "1", activity: storedRaceActivity }],
      p_runner_candidates: [expect.objectContaining({ runner_id: runnerId })],
    }));
  });

  it("routes revoked legacy project refetch through the fenced failure only", async () => {
    const normal = mocks.rows.getMockImplementation()!;
    mocks.rows.mockImplementation((table, filters, single) => table === "strava_runner_activities"
      ? Promise.resolve({ data: { activity_id: "1" } }) : table === "strava_activities"
        ? Promise.resolve({ data: { activity: { ...storedRaceActivity, movingTimeSeconds: undefined } } })
        : normal(table, filters, single));
    mocks.activity.mockRejectedValue(new StravaError("authorization_revoked", 409));
    claim({ ...job, kind: "project", payload: { runner_id: runnerId, activity_id: "1", build_id: "old", version: 1 } });
    await processStravaJobs();
    expect(mocks.rpc).not.toHaveBeenCalledWith("strava_provider_revoked", expect.anything());
    expect(mocks.rpc).toHaveBeenCalledWith("strava_fail_projection_job", expect.objectContaining({ p_error: "authorization_revoked" }));
  });

  it("commits a ready projection from complete selected detail", async () => {
    const normal = mocks.rows.getMockImplementation()!;
    mocks.rows.mockImplementation((table, filters, single) => {
      if (table === "strava_runner_activities") return Promise.resolve({ data: { activity_id: "1" } });
      if (table === "strava_activities") return Promise.resolve({ data: { activity: storedRaceActivity } });
      if (table === "runners") return Promise.resolve({ data: { category_id: 7, name: "Runner", bib_number: "12" } });
      if (table === "categories") return Promise.resolve({ data: { distance_km: 5, name: "5K", event_id: 8 } });
      if (table === "events") return Promise.resolve({ data: { name: "Race", event_date: "2027-08-17" } });
      return normal(table, filters, single);
    });
    claim({ ...job, kind: "project", payload: { runner_id: runnerId, activity_id: "1", build_id: "build", version: 1 } });
    await processStravaJobs();
    expect(mocks.activity).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("strava_commit_projection_fenced", expect.objectContaining({
      p_job: "job", p_lease: "lease", p_payload: expect.objectContaining({ version: 1, movingTimeSeconds: 1480 }),
    }));
  });

  it("schedules a rate-limited legacy refetch for retry", async () => {
    const normal = mocks.rows.getMockImplementation()!;
    mocks.rows.mockImplementation((table, filters, single) => table === "strava_runner_activities"
      ? Promise.resolve({ data: { activity_id: "1" } }) : table === "strava_activities"
        ? Promise.resolve({ data: { activity: { ...storedRaceActivity, elapsedTimeSeconds: undefined } } }) : normal(table, filters, single));
    mocks.activity.mockRejectedValue(new StravaError("rate_limited", 503, 60));
    claim({ ...job, kind: "project", payload: { runner_id: runnerId, activity_id: "1", build_id: "build", version: 1 } });
    await processStravaJobs();
    expect(mocks.rpc).toHaveBeenCalledWith("strava_fail_projection_job", expect.objectContaining({ p_error: "rate_limited", p_delay: 60 }));
  });

  it("marks a malformed projection failed", async () => {
    const normal = mocks.rows.getMockImplementation()!;
    mocks.rows.mockImplementation((table, filters, single) => {
      if (table === "strava_runner_activities") return Promise.resolve({ data: { activity_id: "1" } });
      if (table === "strava_activities") return Promise.resolve({ data: { activity: storedRaceActivity } });
      if (table === "runners") return Promise.resolve({ data: { category_id: 7, name: "Runner", bib_number: "12" } });
      if (table === "categories") return Promise.resolve({ data: { name: "5K", event_id: 8 } });
      if (table === "events") return Promise.resolve({ data: { name: "Race", event_date: "2027-08-17" } });
      return normal(table, filters, single);
    });
    const broken = vi.spyOn(projection, "buildStravaWrappedProjection").mockReturnValue({ version: 1 } as ReturnType<typeof projection.buildStravaWrappedProjection>);
    claim({ ...job, kind: "project", payload: { runner_id: runnerId, activity_id: "1", build_id: "build", version: 1 } });
    try {
      await processStravaJobs();
      expect(mocks.rpc).toHaveBeenCalledWith("strava_commit_projection_fenced", expect.objectContaining({ p_payload: null, p_error: "invalid_projection" }));
    } finally { broken.mockRestore(); }
  });

  it.each([
    ["unexpected runner field", (p: ReturnType<typeof projection.buildStravaWrappedProjection>) => { Object.assign(p.runner, { location: [1, 2] }); }],
    ["invalid split", (p: ReturnType<typeof projection.buildStravaWrappedProjection>) => { p.splits = [Object.assign({ kilometer: 1, distanceMeters: 1000, movingSeconds: 100, elapsedSeconds: 100, averageSpeedMps: null, paceSecondsPerKm: 100 }, { route: "secret" })]; }],
    ["invalid insight", (p: ReturnType<typeof projection.buildStravaWrappedProjection>) => { p.paceTrend = { direction: "other" as "faster", earlyPaceSecondsPerKm: 10, latePaceSecondsPerKm: 20 }; }],
    ["fractional duration", (p: ReturnType<typeof projection.buildStravaWrappedProjection>) => { p.movingTimeSeconds = 0.5; }],
  ])("rejects %s in a projection", async (_name, change) => {
    const normal = mocks.rows.getMockImplementation()!;
    mocks.rows.mockImplementation((table, filters, single) => {
      if (table === "strava_runner_activities") return Promise.resolve({ data: { activity_id: "1" } });
      if (table === "strava_activities") return Promise.resolve({ data: { activity: storedRaceActivity } });
      if (table === "runners") return Promise.resolve({ data: { category_id: 7, name: "Runner", bib_number: "12" } });
      if (table === "categories") return Promise.resolve({ data: { name: "5K", event_id: 8 } });
      if (table === "events") return Promise.resolve({ data: { name: "Race", event_date: "2027-08-17" } });
      return normal(table, filters, single);
    });
    const payload = projection.buildStravaWrappedProjection(storedRaceActivity, { runnerId, runnerName: "Runner", bibNumber: "12", eventName: "Race", eventDate: "2027-08-17", categoryName: "5K" });
    change(payload);
    const broken = vi.spyOn(projection, "buildStravaWrappedProjection").mockReturnValue(payload);
    claim({ ...job, kind: "project", payload: { runner_id: runnerId, activity_id: "1", build_id: "build", version: 1 } });
    try {
      await processStravaJobs();
      expect(mocks.rpc).toHaveBeenCalledWith("strava_commit_projection_fenced", expect.objectContaining({ p_payload: null, p_error: "invalid_projection" }));
    } finally { broken.mockRestore(); }
  });

  const configuredRunner = () => {
    mocks.rows.mockImplementation(async (table, filters, single) => {
      const rows: Record<string, unknown> = {
        strava_oauth_attempts: { runner_id: runnerId },
        strava_runner_attachments: { runner_id: runnerId, created_at: "first", attachment_id: "first" },
        runner_access: { runner_id: filters.runner_id ?? runnerId }, runners: { category_id: 7 },
        categories: { distance_km: 5 }, strava_race_configs: raceConfig,
      };
      return { data: single ? rows[table] : [rows[table]] };
    });
    mocks.activity.mockResolvedValue(raceActivity);
  };

  it("publishes a discovery classification only for its requested attachment", async () => {
    configuredRunner();
    const normal = mocks.rows.getMockImplementation()!;
    mocks.rows.mockImplementation((table, filters, single) => table === "strava_runner_attachments"
      ? Promise.resolve({ data: [{ runner_id: runnerId, attachment_id: "first" }, { runner_id: otherRunner, attachment_id: "second" }] })
      : normal(table, filters, single));
    claim({ ...job, kind: "activity", attachment_fences: { [otherRunner]: "second" }, payload: { object_id: "1", owner_id: "2", runner_id: otherRunner } });
    await processStravaJobs();
    const commit = mocks.rpc.mock.calls.find(([name]) => name === "strava_commit_runner_job")![1];
    expect(commit.p_runner_candidates.map((batch: { runner_id: string }) => batch.runner_id)).toEqual([otherRunner]);
  });

  it.each([
    [storedRaceActivity, [-6.2, 106.8], "auto_match", "race_checks_passed"],
    [raceActivity, [-6.3, 106.8], "no_match", "outside_start_area"],
  ])("classifies scoped discovery using fresh location instead of stored detail", async (cached, coordinates, status, reason) => {
    configuredRunner();
    const normal = mocks.rows.getMockImplementation()!;
    mocks.rows.mockImplementation((table, filters, single) => table === "strava_activities"
      ? Promise.resolve({ data: { activity: cached } }) : normal(table, filters, single));
    mocks.activity.mockResolvedValue({ ...raceActivity, startLatLng: coordinates });
    claim({ ...job, kind: "activity", payload: { object_id: "1", owner_id: "2", runner_id: runnerId } });

    await processStravaJobs();

    expect(mocks.activity).toHaveBeenCalledWith("access", "1", "2");
    const commit = mocks.rpc.mock.calls.find(([name]) => name === "strava_commit_runner_job")![1];
    expect(commit.p_runner_candidates[0].candidates).toEqual([
      expect.objectContaining({ match_status: status, reason }),
    ]);
  });

  it("suppresses a genuinely in-flight shared webhook after detach and reattach", async () => {
    configuredRunner();
    const normal = mocks.rows.getMockImplementation()!;
    let incarnation = "first";
    mocks.rows.mockImplementation((table, filters, single) => table === "strava_runner_attachments"
      ? Promise.resolve({ data: [{ runner_id: runnerId, attachment_id: incarnation }] }) : normal(table, filters, single));
    let started!: () => void;
    const fetching = new Promise<void>((resolve) => { started = resolve; });
    let release!: (value: typeof raceActivity) => void;
    mocks.activity.mockImplementation(() => { started(); return new Promise((resolve) => { release = resolve; }); });
    claim({ ...job, attachment_fences: { [runnerId]: "first" } });
    const processing = processStravaJobs();
    await fetching;
    incarnation = "replacement";
    release(raceActivity);
    await processing;
    const commit = mocks.rpc.mock.calls.find(([name]) => name === "strava_commit_runner_job")![1];
    expect(commit.p_runner_candidates).toEqual([]);
    expect(commit.p_activities).toEqual([]);
  });

  it("publishes a runner-specific negative classification while another attachment still qualifies", async () => {
    configuredRunner();
    const normal = mocks.rows.getMockImplementation()!;
    mocks.rows.mockImplementation((table, filters, single) => {
      if (table === "strava_runner_attachments") return Promise.resolve({ data: [{ runner_id: runnerId, attachment_id: "first" }, { runner_id: otherRunner, attachment_id: "second" }] });
      if (table === "runners" && filters.id === runnerId) return Promise.resolve({ data: { category_id: 8 } });
      if (table === "categories" && filters.id === 8) return Promise.resolve({ data: { distance_km: 10 } });
      return normal(table, filters, single);
    });
    claim({ ...job, attachment_fences: { [runnerId]: "first", [otherRunner]: "second" } });
    await processStravaJobs();
    const commit = mocks.rpc.mock.calls.find(([name]) => name === "strava_commit_runner_job")![1];
    expect(commit.p_runner_candidates[0].candidates).toEqual([expect.objectContaining({ activity_id: "1", match_status: "no_match" })]);
    expect(commit.p_runner_candidates[1].candidates).toEqual([expect.objectContaining({ activity_id: "1", match_status: "auto_match" })]);
    expect(commit.p_activities).toEqual([{ id: "1", activity: storedRaceActivity }]);
  });

  it("classifies a webhook for both explicitly attached owned runners", async () => {
    configuredRunner();
    const normal = mocks.rows.getMockImplementation()!;
    mocks.rows.mockImplementation((table, filters, single) => table === "strava_runner_attachments"
      ? Promise.resolve({ data: [{ runner_id: runnerId, created_at: "first", attachment_id: "first" }, { runner_id: otherRunner, created_at: "second", attachment_id: "second" }] })
      : normal(table, filters, single));
    claim({ ...job, attachment_fences: { [runnerId]: "first", [otherRunner]: "second" } });
    await processStravaJobs();
    const commit = mocks.rpc.mock.calls.find(([name]) => name === "strava_commit_runner_job")![1];
    expect(commit.p_runner_candidates.map((batch: { runner_id: string }) => batch.runner_id)).toEqual([runnerId, otherRunner]);
  });

  it("imports the second runner's bounded backfill without an OAuth attempt for it", async () => {
    configuredRunner();
    const normal = mocks.rows.getMockImplementation()!;
    mocks.rows.mockImplementation((table, filters, single) => table === "strava_runner_attachments"
      ? Promise.resolve({ data: single ? { runner_id: otherRunner, created_at: "second", attachment_id: "second" } : [{ runner_id: runnerId, created_at: "first", attachment_id: "first" }, { runner_id: otherRunner, created_at: "second", attachment_id: "second" }] })
      : normal(table, filters, single));
    claim({ ...job, kind: "backfill", attachment_fences: { [otherRunner]: "second" }, payload: { after: 1818460799, before: 1818468001, page: 1, runner_id: otherRunner } });
    mocks.list.mockResolvedValue([{ id: "11" }]);
    await processStravaJobs();
    const commit = mocks.rpc.mock.calls.find(([name]) => name === "strava_commit_runner_job")![1];
    expect(commit.p_discoveries).toEqual([{ object_id: "11", owner_id: "2", runner_id: otherRunner }]);
  });

  it("matches only the runner who opted in even when another owned runner has identical race configuration", async () => {
    configuredRunner();
    const normal = mocks.rows.getMockImplementation()!;
    const other = "22222222-2222-2222-2222-222222222222";
    mocks.rows.mockImplementation((table, filters, single) => table === "runner_access" && !filters.runner_id
      ? Promise.resolve({ data: [{ runner_id: runnerId }, { runner_id: other }] }) : normal(table, filters, single));
    claim();
    await processStravaJobs();
    const commit = mocks.rpc.mock.calls.find(([name]) => name === "strava_commit_runner_job")![1];
    expect(commit.p_runner_candidates.map((batch: { runner_id: string }) => batch.runner_id)).toEqual([runnerId]);
  });

  it.each([
    { startDate: "2027-08-18T01:00:00Z" }, { sportType: "Ride" }, { distanceMeters: 4000 },
  ])("removes private detail for an unrelated workout %j", async (override) => {
    configuredRunner();
    mocks.activity.mockResolvedValue({ ...raceActivity, ...override });
    claim();
    await processStravaJobs();
    const commit = mocks.rpc.mock.calls.find(([name]) => name === "strava_commit_runner_job")![1];
    expect(commit.p_activities).toEqual([{ id: "1", activity: null }]);
    expect(commit.p_runner_candidates.flatMap((batch: { candidates: unknown[] }) => batch.candidates)).toEqual([expect.objectContaining({ match_status: "no_match" })]);
  });

  it("does not import private details when the opted-in runner has no approved configuration", async () => {
    configuredRunner();
    const normal = mocks.rows.getMockImplementation()!;
    mocks.rows.mockImplementation((table, filters, single) => table === "strava_race_configs"
      ? Promise.resolve({ data: null }) : normal(table, filters, single));
    claim();
    await processStravaJobs();
    const commit = mocks.rpc.mock.calls.find(([name]) => name === "strava_commit_runner_job")![1];
    expect(commit.p_activities).toEqual([{ id: "1", activity: null }]);
    expect(commit.p_runner_candidates).toEqual([]);
  });

  it("does not import for a generation without a completed runner opt-in", async () => {
    configuredRunner();
    const normal = mocks.rows.getMockImplementation()!;
    mocks.rows.mockImplementation((table, filters, single) => table === "strava_runner_attachments"
      ? Promise.resolve({ data: [] }) : normal(table, filters, single));
    claim();
    await processStravaJobs();
    const commit = mocks.rpc.mock.calls.find(([name]) => name === "strava_commit_runner_job")![1];
    expect(commit.p_runner_candidates).toEqual([]);
    expect(commit.p_activities).toEqual([]);
    expect(mocks.activity).not.toHaveBeenCalled();
  });
  it("does not fetch a queued detail bound to a different runner", async () => {
    configuredRunner();
    claim({ ...job, kind: "activity", payload: { object_id: "1", owner_id: "2", runner_id: "22222222-2222-2222-2222-222222222222" } });
    await processStravaJobs();
    expect(mocks.activity).not.toHaveBeenCalled();
    const commit = mocks.rpc.mock.calls.find(([name]) => name === "strava_commit_runner_job")![1];
    expect(commit.p_activities).toEqual([]);
  });

  it("commits race classifications with the activity lease and keeps private location out of summaries", async () => {
    configuredRunner();
    claim();
    await processStravaJobs();
    expect(mocks.rpc).toHaveBeenCalledWith("strava_commit_runner_job", expect.objectContaining({
      p_job: "job", p_lease: "lease",
      p_runner_candidates: [{ runner_id: runnerId, candidates: [{
        activity_id: "1", match_status: "auto_match", reason: "race_checks_passed",
        summary: { startDate: "2027-08-17T01:00:00Z", distanceMeters: 5000, gpsAvailable: true },
      }] }],
    }));
  });

  it.each([
    [{ startLatLng: null }, "needs_confirmation", "missing_start_location"],
    [{ sportType: "Ride" }, "no_match", "wrong_sport"],
    [{ startDate: "2027-08-18T01:00:00Z" }, "no_match", "outside_start_window"],
    [{ distanceMeters: 4000 }, "no_match", "distance_mismatch"],
  ])("classifies detail overrides %j", async (override, status, reason) => {
    configuredRunner();
    mocks.activity.mockResolvedValue({ ...raceActivity, ...override });
    claim();
    await processStravaJobs();
    expect(mocks.rpc).toHaveBeenCalledWith("strava_commit_runner_job", expect.objectContaining({
      p_runner_candidates: [{ runner_id: runnerId, candidates: [expect.objectContaining({ match_status: status, reason })] }],
    }));
  });

  it("queues the owned category's inclusive start window with runner-specific deduplication", async () => {
    configuredRunner();
    await enqueueRunnerStravaBackfill("user", runnerId);
    expect(mocks.rpc).toHaveBeenLastCalledWith("strava_enqueue_runner_backfill", {
      p_user: "user", p_generation: "generation", p_runner: runnerId, p_attachment: "first",
      p_after: 1818460799, p_before: 1818468001,
    });
    expect(mocks.rows).toHaveBeenCalledWith("runner_access", { user_id: "user", runner_id: runnerId }, true);
  });

  it("passes the observed attachment incarnation to atomic enqueue and rejects a stale result", async () => {
    configuredRunner();
    mocks.rpc.mockResolvedValue(false);
    await expect(enqueueRunnerStravaBackfill("user", runnerId)).rejects.toMatchObject({ code: "runner_not_connected", status: 409 });
    expect(mocks.rpc).toHaveBeenCalledWith("strava_enqueue_runner_backfill", {
      p_user: "user", p_generation: "generation", p_runner: runnerId, p_attachment: "first", p_after: 1818460799, p_before: 1818468001,
    });
  });

  it("rejects foreign runner backfills before contacting Strava", async () => {
    mocks.rows.mockResolvedValue({ data: null });
    await expect(enqueueRunnerStravaBackfill("user", runnerId)).rejects.toMatchObject({ code: "runner_not_found" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("leaves an owned runner without race configuration connected without inventing a window", async () => {
    configuredRunner();
    const normal = mocks.rows.getMockImplementation()!;
    mocks.rows.mockImplementation((table, filters, single) => table === "strava_race_configs"
      ? Promise.resolve({ data: null }) : normal(table, filters, single));
    await expect(enqueueRunnerStravaBackfill("user", runnerId)).resolves.toBeUndefined();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("does not classify when disconnect changes the generation during the provider request", async () => {
    configuredRunner();
    claim();
    mocks.activity.mockImplementation(async () => {
      mocks.connection.mockResolvedValue({ ...connection, status: "disconnecting", generation: "new" });
      return raceActivity;
    });
    await processStravaJobs();
    expect(mocks.rpc).toHaveBeenCalledWith("strava_commit_runner_job", expect.objectContaining({ p_runner_candidates: [] }));
    expect(mocks.rpc).toHaveBeenCalledWith("strava_commit_runner_job", expect.objectContaining({
      p_activities: [{ id: "1", activity: null }],
    }));
  });

  it("retains runner context on subsequent backfill pages", async () => {
    configuredRunner();
    claim({ ...job, kind: "backfill", payload: { after: 1818460799, before: 1818468001, page: 1, runner_id: runnerId } });
    mocks.list.mockResolvedValue(Array.from({ length: 25 }, (_, i) => ({ id: String(i + 1) })));
    await processStravaJobs();
    expect(mocks.rpc).toHaveBeenCalledWith("strava_commit_runner_job", expect.objectContaining({
      p_continuation: { key: `runner:${runnerId}:backfill:1818460799:1818468001:2`, payload: { after: 1818460799, before: 1818468001, page: 2, runner_id: runnerId } },
    }));
  });

  it("keeps a failed atomic matching commit retryable", async () => {
    configuredRunner();
    claim();
    const normal = mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation((name, args) => name === "strava_commit_runner_job"
      ? Promise.reject(new Error("storage failed")) : normal(name, args));
    await processStravaJobs();
    expect(mocks.rpc).toHaveBeenCalledWith("strava_commit_job", expect.objectContaining({
      p_error: "storage_unavailable", p_delay: expect.any(Number), p_reauth: false,
    }));
  });
  it("deduplicates equivalent update key order without fetching at webhook receipt", async () => {
    await enqueueWebhookEvent({ ...event, updates: { title: "New", private: "false" } });
    await enqueueWebhookEvent({ ...event, updates: { private: "false", title: "New" } });

    expect(mocks.rpc.mock.calls[0][1].p_key).toBe(mocks.rpc.mock.calls[1][1].p_key);
    expect(mocks.activity).not.toHaveBeenCalled();
  });

  it("ignores unknown athletes and rejects a different subscription", async () => {
    mocks.owner.mockResolvedValue({ data: null });

    await enqueueWebhookEvent(event);

    expect(mocks.rpc).not.toHaveBeenCalled();
    await expect(
      enqueueWebhookEvent({ ...event, subscription_id: 4 }),
    ).rejects.toMatchObject({ code: "invalid_subscription" });
  });

  it("commits fetched activity only with the claimed lease", async () => {
    configuredRunner();
    claim();

    await processStravaJobs();

    expect(mocks.activity).toHaveBeenCalledWith("access", "1", "2");
    expect(mocks.rpc).toHaveBeenCalledWith(
      "strava_commit_runner_job",
      expect.objectContaining({
        p_job: "job",
        p_lease: "lease",
        p_activities: [
          { id: "1", activity: storedRaceActivity },
        ],
      }),
    );
  });

  it("matches on exact GPS and sends only allowlisted activity fields to storage", async () => {
    configuredRunner();
    const split = { kilometer: 1, distanceMeters: 1000, movingSeconds: 300, elapsedSeconds: 304, averageSpeedMps: null };
    const privateFields = {
      coordinates: [1.2345, 6.789], route: {}, polyline: "private-route",
      accessToken: "private-token", rawPayload: { start_latlng: [1.2345, 6.789] },
    };
    mocks.activity.mockResolvedValue({
      ...raceActivity, ...privateFields,
      metricSplits: [{ ...split, ...privateFields }],
    });
    claim();

    await processStravaJobs();

    const commit = mocks.rpc.mock.calls.find(([name]) => name === "strava_commit_runner_job")![1];
    expect(commit.p_runner_candidates[0].candidates).toEqual([
      expect.objectContaining({ match_status: "auto_match", reason: "race_checks_passed" }),
    ]);
    expect(commit.p_activities).toEqual([{ id: "1", activity: { ...storedRaceActivity, metricSplits: [split] } }]);
    expect(JSON.stringify(commit)).not.toMatch(/"(?:startLatLng|start_latlng|coordinates|route|polyline|accessToken|rawPayload)"|-6\.2|106\.8/);
  });

  it("ignores obsolete connection generations", async () => {
    claim();
    mocks.connection.mockResolvedValue({ ...connection, generation: "replacement" });

    await processStravaJobs();

    expect(mocks.activity).not.toHaveBeenCalled();
  });

  it("does not trust a deletion POST while the activity remains accessible", async () => {
    configuredRunner();
    claim({ ...job, payload: { ...event, aspect_type: "delete" } });

    await processStravaJobs();

    expect(mocks.rpc).toHaveBeenCalledWith(
      "strava_commit_runner_job",
      expect.objectContaining({
        p_activities: [
          expect.objectContaining({
            activity: expect.objectContaining({ id: "1", distanceMeters: 5000 }),
          }),
        ],
      }),
    );
  });

  it("clears activity only when the provider confirms loss of access", async () => {
    claim();
    mocks.activity.mockRejectedValue(new StravaError("not_found", 404));

    await processStravaJobs();

    expect(mocks.rpc).toHaveBeenCalledWith(
      "strava_commit_runner_job",
      expect.objectContaining({ p_activities: [{ id: "1", activity: null }] }),
    );
  });

  it("retries rate limits without losing the active connection", async () => {
    claim();
    mocks.activity.mockRejectedValue(new StravaError("rate_limited", 503, 1200));

    await processStravaJobs();

    expect(mocks.rpc).toHaveBeenCalledWith(
      "strava_commit_job",
      expect.objectContaining({
        p_error: "rate_limited",
        p_delay: 1200,
        p_reauth: false,
      }),
    );
  });

  it("retries one activity 401 using a coordinated refresh, not an infinite loop", async () => {
    claim();
    mocks.activity.mockRejectedValue(new StravaError("reauth_required", 409));

    await processStravaJobs();

    expect(mocks.activity).toHaveBeenCalledTimes(2);
    expect(mocks.access).toHaveBeenLastCalledWith("user", true);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "strava_commit_job",
      expect.objectContaining({
        p_error: "reauth_required",
        p_delay: null,
        p_reauth: true,
      }),
    );
  });

  it("does not trust a deauthorization POST with working current credentials", async () => {
    claim({
      ...job,
      payload: {
        ...event,
        object_type: "athlete",
        object_id: 2,
        updates: { authorized: "false" },
      },
    });
    mocks.connection.mockResolvedValue({
      ...connection,
      access_token: await encryptToken("access"),
    });

    await processStravaJobs();

    expect(mocks.verify).toHaveBeenCalledWith("access", "2");
    expect(
      mocks.rpc.mock.calls.some(([name]) => name === "strava_provider_revoked"),
    ).toBe(false);
  });

  it("cleans confirmed provider revocation without revoking again", async () => {
    claim({
      ...job,
      payload: {
        ...event,
        object_type: "athlete",
        object_id: 2,
        updates: { authorized: false },
      },
    });
    mocks.connection.mockResolvedValue({
      ...connection,
      access_token: await encryptToken("old"),
    });
    mocks.verify.mockRejectedValue(new StravaError("reauth_required", 409));
    mocks.access.mockRejectedValue(new StravaError("authorization_revoked", 409));

    await processStravaJobs();

    expect(mocks.rpc).toHaveBeenCalledWith("strava_provider_revoked", {
      p_user: "user",
      p_generation: "generation",
    });
    expect(mocks.revoke).not.toHaveBeenCalled();
  });

  it("queues bounded backfill pages and fetches details separately", async () => {
    configuredRunner();
    claim({
      ...job,
      kind: "backfill",
      payload: { after: 1818460799, before: 1818468001, page: 1, runner_id: runnerId },
    });
    mocks.list.mockResolvedValue(
      Array.from({ length: 25 }, (_, i) => ({ id: String(i + 1) })),
    );

    await processStravaJobs();

    expect(mocks.list).toHaveBeenCalledWith("access", 1818460799, 1818468001, 1, "2");
    expect(mocks.rpc).toHaveBeenCalledWith(
      "strava_commit_runner_job",
      expect.objectContaining({
        p_activities: [],
        p_discoveries: expect.arrayContaining([
          expect.objectContaining({ object_id: "1", runner_id: runnerId }),
        ]),
        p_continuation: {
          key: `runner:${runnerId}:backfill:1818460799:1818468001:2`,
          payload: { after: 1818460799, before: 1818468001, page: 2, runner_id: runnerId },
        },
      }),
    );
    expect(mocks.activity).not.toHaveBeenCalled();
  });

  it("ends an empty import and only schedules explicit valid windows", async () => {
    configuredRunner();
    claim({
      ...job,
      kind: "backfill",
      payload: { after: 1818460799, before: 1818468001, page: 1, runner_id: runnerId },
    });
    mocks.list.mockResolvedValue([]);

    await processStravaJobs();

    expect(mocks.rpc).toHaveBeenCalledWith(
      "strava_commit_runner_job",
      expect.objectContaining({ p_continuation: null, p_discoveries: [] }),
    );
    await expect(enqueueStravaBackfill("user", 200, 100)).rejects.toMatchObject({
      code: "invalid_window",
    });

    await expect(enqueueStravaBackfill("user", 100, 200)).rejects.toMatchObject({ code: "invalid_window" });
    await enqueueStravaBackfill("user", 1818460799, 1818468001);

    expect(mocks.rpc).toHaveBeenLastCalledWith(
      "strava_enqueue_runner_backfill",
      expect.objectContaining({ p_runner: runnerId, p_attachment: "first", p_after: 1818460799, p_before: 1818468001 }),
    );
  });

  it("keeps local ingestion disabled and returns pending when revocation fails", async () => {
    mocks.rpc.mockImplementation(async (name) =>
      name === "strava_claim_credentials"
        ? {
            ...connection,
            status: "disconnecting",
            operation_id: "op",
            refresh_token: await encryptToken("refresh"),
          }
        : true,
    );
    mocks.revoke.mockRejectedValue(new StravaError("provider_unavailable"));

    expect(await disconnectStravaUser("user")).toBe("disconnecting");
    expect(mocks.rpc.mock.calls[0][0]).toBe("strava_disconnect");
    expect(
      mocks.rpc.mock.calls.some(([name]) => name === "strava_finish_disconnect"),
    ).toBe(false);
  });

  it("does not claim remote revocation with possibly rotated lost credentials", async () => {
    mocks.rpc.mockImplementation(async (name) =>
      name === "strava_claim_credentials"
        ? { ...connection, credentials_uncertain: true, operation_id: "op" }
        : true,
    );

    expect(await disconnectStravaUser("user")).toBe("reauthorize_to_disconnect");
    expect(mocks.revoke).not.toHaveBeenCalled();
  });
});
