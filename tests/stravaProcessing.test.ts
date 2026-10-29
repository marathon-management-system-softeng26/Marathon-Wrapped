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
}));

vi.mock("@/lib/strava/store", () => ({ stravaRpc: mocks.rpc }));

vi.mock("@/lib/supabaseServer", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: mocks.owner }),
        }),
      }),
    }),
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
import {
  disconnectStravaUser,
  enqueueStravaBackfill,
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
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("STRAVA_ENCRYPTION_KEY", "01".repeat(32));
  vi.stubEnv("STRAVA_SUBSCRIPTION_ID", "3");
  mocks.connection.mockResolvedValue(connection);
  mocks.access.mockResolvedValue("access");
  mocks.activity.mockResolvedValue({ id: "1", athleteId: "2", polyline: "route" });
  mocks.owner.mockResolvedValue({ data: { user_id: "user", generation: "generation" } });
  mocks.rpc.mockImplementation(async (name) =>
    name === "strava_claim_job" ? null : true,
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const claim = (value: Record<string, unknown> = job) => {
  let claimed = false;

  mocks.rpc.mockImplementation(async (name) =>
    name === "strava_claim_job"
      ? claimed
        ? null
        : (claimed = true, value)
      : true,
  );
};

describe("Strava processing", () => {
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
    claim();

    await processStravaJobs();

    expect(mocks.activity).toHaveBeenCalledWith("access", "1", "2");
    expect(mocks.rpc).toHaveBeenCalledWith(
      "strava_commit_job",
      expect.objectContaining({
        p_job: "job",
        p_lease: "lease",
        p_activities: [
          { id: "1", activity: { id: "1", athleteId: "2", polyline: "route" } },
        ],
      }),
    );
  });

  it("ignores obsolete connection generations", async () => {
    claim();
    mocks.connection.mockResolvedValue({ ...connection, generation: "replacement" });

    await processStravaJobs();

    expect(mocks.activity).not.toHaveBeenCalled();
  });

  it("does not trust a deletion POST while the activity remains accessible", async () => {
    claim({ ...job, payload: { ...event, aspect_type: "delete" } });

    await processStravaJobs();

    expect(mocks.rpc).toHaveBeenCalledWith(
      "strava_commit_job",
      expect.objectContaining({
        p_activities: [
          expect.objectContaining({
            activity: expect.objectContaining({ polyline: "route" }),
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
      "strava_commit_job",
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
    claim({
      ...job,
      kind: "backfill",
      payload: { after: 100, before: 200, page: 1 },
    });
    mocks.list.mockResolvedValue(
      Array.from({ length: 25 }, (_, i) => ({ id: String(i + 1) })),
    );

    await processStravaJobs();

    expect(mocks.list).toHaveBeenCalledWith("access", 100, 200, 1, "2");
    expect(mocks.rpc).toHaveBeenCalledWith(
      "strava_commit_job",
      expect.objectContaining({
        p_activities: [],
        p_discoveries: expect.arrayContaining([
          expect.objectContaining({ object_id: "1" }),
        ]),
        p_continuation: {
          key: "backfill:100:200:2",
          payload: { after: 100, before: 200, page: 2 },
        },
      }),
    );
    expect(mocks.activity).not.toHaveBeenCalled();
  });

  it("ends an empty import and only schedules explicit valid windows", async () => {
    claim({
      ...job,
      kind: "backfill",
      payload: { after: 100, before: 200, page: 1 },
    });
    mocks.list.mockResolvedValue([]);

    await processStravaJobs();

    expect(mocks.rpc).toHaveBeenCalledWith(
      "strava_commit_job",
      expect.objectContaining({ p_continuation: null, p_discoveries: [] }),
    );
    await expect(enqueueStravaBackfill("user", 200, 100)).rejects.toMatchObject({
      code: "invalid_window",
    });

    await enqueueStravaBackfill("user", 100, 200);

    expect(mocks.rpc).toHaveBeenLastCalledWith(
      "strava_enqueue",
      expect.objectContaining({ p_key: "backfill:100:200:1" }),
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
