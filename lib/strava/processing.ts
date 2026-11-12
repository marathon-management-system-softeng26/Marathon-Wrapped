import "server-only";
import crypto from "node:crypto";
import { getSupabaseAdmin } from "../supabaseServer";
import { isRunnerId } from "../runnerValidation";
import {
  decryptToken,
  getStravaActivity,
  getUserStravaAccessToken,
  listStravaActivities,
  loadStravaConnection,
  revokeStravaAccess,
  StravaConnection,
  StravaError,
  stravaId,
  verifyStravaAuthorization,
} from "./client";
import {
  loadRunnerRaceConfigs,
  loadStravaRunnerAttachment,
  loadStravaRunnerAttachments,
  stravaRpc,
  toStoredStravaActivity,
  type StoredStravaActivity,
} from "./store";
import { matchActivityToRace } from "./matching";

export type StravaWebhookEvent = {
  object_type: "activity" | "athlete";
  object_id: number;
  aspect_type: "create" | "update" | "delete";
  owner_id: number;
  subscription_id: number;
  event_time: number;
  updates?: Record<string, string | boolean>;
};

export type RunnerStravaRoute = {
  status:
    | "disconnected"
    | "disconnecting"
    | "reauthorize_to_disconnect"
    | "reauth_required"
    | "importing"
    | "matched"
    | "needs_confirmation"
    | "no_match"
    | "unavailable";
  activityId: string | null;
  candidates: RunnerStravaCandidate[];
  metrics: Partial<Record<StravaMetric, number>>;
};

export type RunnerStravaCandidate = {
  activityId: string;
  startTimeLocal: string;
  distanceMeters: number;
  sportType: string;
  gpsAvailable: boolean;
  matchReason: string;
};

type StravaMetric = "avg_heartrate" | "max_heartrate" | "elevation_gain_m" | "calories" | "avg_cadence";
const metricFields: StravaMetric[] = ["avg_heartrate", "max_heartrate", "elevation_gain_m", "calories", "avg_cadence"];

function availableMetrics(value: Record<string, unknown>): Partial<Record<StravaMetric, number>> {
  const result: Partial<Record<StravaMetric, number>> = {};
  for (const field of metricFields) {
    const metric = value[field];
    if (typeof metric === "number" && Number.isFinite(metric) && metric >= 0) result[field] = metric;
  }
  return result;
}

type StravaJob = {
  id: string;
  user_id: string;
  generation: string;
  kind: "webhook" | "activity" | "backfill" | "revoke";
  payload: Record<string, unknown>;
  lease_id: string;
  attempts: number;
  attachment_fences: Record<string, string>;
};

type ActivityWrite = {
  id: string;
  activity: Awaited<ReturnType<typeof getStravaActivity>> | null;
};

export function validateStravaWebhookEvent(value: unknown): StravaWebhookEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StravaError("invalid_webhook", 400);
  }

  const event = value as StravaWebhookEvent;

  if (
    !["activity", "athlete"].includes(event.object_type) ||
    !["create", "update", "delete"].includes(event.aspect_type) ||
    ![event.object_id, event.owner_id, event.subscription_id, event.event_time].every(
      (n) => Number.isSafeInteger(n) && n > 0,
    ) ||
    event.event_time > Date.now() / 1000 + 300 ||
    (event.object_type === "athlete" && event.object_id !== event.owner_id)
  ) {
    throw new StravaError("invalid_webhook", 400);
  }

  if (
    event.updates !== undefined &&
    (!event.updates ||
      typeof event.updates !== "object" ||
      Array.isArray(event.updates) ||
      Object.entries(event.updates).length > 20 ||
      Object.entries(event.updates).some(
        ([key, item]) =>
          key.length > 100 ||
          (typeof item !== "boolean" &&
            (typeof item !== "string" || item.length > 1024)),
      ))
  ) {
    throw new StravaError("invalid_webhook", 400);
  }

  return {
    object_type: event.object_type,
    object_id: event.object_id,
    aspect_type: event.aspect_type,
    owner_id: event.owner_id,
    subscription_id: event.subscription_id,
    event_time: event.event_time,
    updates: Object.fromEntries(
      Object.entries(event.updates ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
}

export async function enqueueWebhookEvent(value: StravaWebhookEvent): Promise<void> {
  const event = validateStravaWebhookEvent(value);
  const subscription = process.env.STRAVA_SUBSCRIPTION_ID;

  if (!subscription || !/^[1-9]\d*$/.test(subscription)) {
    throw new StravaError("webhook_not_configured");
  }

  if (String(event.subscription_id) !== subscription) {
    throw new StravaError("invalid_subscription", 400);
  }

  const { data, error } = await getSupabaseAdmin()
    .from("strava_connections")
    .select("user_id,generation")
    .eq("athlete_id", String(event.owner_id))
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    throw new Error("Strava storage is temporarily unavailable.");
  }

  if (!data) {
    return;
  }

  const key = crypto.createHash("sha256").update(JSON.stringify(event)).digest("hex");

  await stravaRpc("strava_enqueue", {
    p_user: data.user_id,
    p_generation: data.generation,
    p_kind: "webhook",
    p_key: key,
    p_payload: event,
  });
}

/** Backend-only: bounds must come from an owned, configured race window, never a browser-supplied user ID. */
export async function enqueueStravaBackfill(
  userId: string,
  after: number,
  before: number,
): Promise<void> {
  if (![after, before].every(Number.isSafeInteger) || after < 0 || after >= before) {
    throw new StravaError("invalid_window", 400);
  }

  const connection = await loadStravaConnection(userId);

  if (!connection || connection.status !== "active") {
    throw new StravaError("not_connected", 409);
  }

  const attachments = await loadStravaRunnerAttachments(userId, connection.generation);
  const races = (await Promise.all(attachments.map(({ runner_id }) => loadRunnerRaceConfigs(userId, runner_id)))).flat()
    .filter(({ config }) => after === Math.floor(Date.parse(config.startTimeFrom) / 1000) - 1 &&
      before === Math.ceil(Date.parse(config.startTimeTo) / 1000) + 1);
  if (!races.length) throw new StravaError("invalid_window", 400);
  for (const race of races) await enqueueRunnerStravaBackfill(userId, race.runnerId);
}

async function currentConnection(job: StravaJob) {
  const connection = await loadStravaConnection(job.user_id);

  if (
    !connection ||
    connection.generation !== job.generation ||
    connection.status !== "active" ||
    !connection.athlete_id
  ) {
    return null;
  }

  return connection;
}

export async function enqueueRunnerStravaBackfill(userId: string, runnerId: string): Promise<void> {
  if (!isRunnerId(runnerId)) throw new StravaError("invalid_runner", 400);
  const [race] = await loadRunnerRaceConfigs(userId, runnerId);
  if (!race) {
    const access = await getSupabaseAdmin().from("runner_access").select("runner_id")
      .eq("user_id", userId).eq("runner_id", runnerId).maybeSingle();
    if (access.error) throw new Error("Strava storage is temporarily unavailable.");
    if (!access.data) throw new StravaError("runner_not_found", 404);
    return; // No approved category window: retain the connection without guessing dates.
  }
  const connection = await loadStravaConnection(userId);
  if (!connection || connection.status !== "active") throw new StravaError("not_connected", 409);
  const attachment = await loadStravaRunnerAttachment(userId, connection.generation, runnerId);
  if (!attachment) throw new StravaError("runner_not_connected", 409);
  // Strava's after/before bounds are exclusive; the matcher includes both endpoints.
  const after = Math.floor(Date.parse(race.config.startTimeFrom) / 1000) - 1;
  const before = Math.ceil(Date.parse(race.config.startTimeTo) / 1000) + 1;
  const enqueued = await stravaRpc<boolean>("strava_enqueue_runner_backfill", {
    p_user: userId, p_generation: connection.generation, p_runner: runnerId,
    p_attachment: attachment.attachment_id, p_after: after, p_before: before,
  });
  if (!enqueued) throw new StravaError("runner_not_connected", 409);
}

async function currentJobAttachments(job: StravaJob) {
  const attachments = (await loadStravaRunnerAttachments(job.user_id, job.generation)).filter(({ runner_id }) =>
    !["activity", "backfill"].includes(job.kind) || typeof job.payload.runner_id !== "string" || runner_id === job.payload.runner_id);
  const fences = job.attachment_fences;
  if (!fences || Object.keys(fences).length !== attachments.length ||
    attachments.some(({ runner_id, attachment_id }) => fences[runner_id] !== attachment_id)) return null;
  return attachments;
}

async function withAccess<T>(
  connection: StravaConnection,
  work: (token: string) => Promise<T>,
): Promise<T> {
  let access = await getUserStravaAccessToken(connection.user_id);

  if (!access) {
    throw new StravaError("not_connected", 409);
  }

  try {
    return await work(access);
  } catch (error) {
    if (!(error instanceof StravaError) || error.code !== "reauth_required") {
      throw error;
    }

    access = await getUserStravaAccessToken(connection.user_id, true);

    if (!access) {
      throw new StravaError("not_connected", 409);
    }

    return work(access);
  }
}

export async function processActivityEvent(
  event: {
    object_id: string | number;
    owner_id: string | number;
  },
  job: StravaJob,
): Promise<ActivityWrite[]> {
  const connection = await currentConnection(job);

  if (!connection || connection.athlete_id !== String(event.owner_id)) {
    return [];
  }

  const attachments = await currentJobAttachments(job);
  if (!attachments?.length) return [];
  // Exact GPS is only available from the provider, including for scoped discovery.
  try {
    const activity = await withAccess(connection, (access) =>
      getStravaActivity(access, String(event.object_id), connection.athlete_id!),
    );

    return [{ id: activity.id, activity }];
  } catch (error) {
    // Even a delete POST is untrusted. Only provider-confirmed absence clears stored data.
    if (
      error instanceof StravaError &&
      ["not_found", "forbidden"].includes(error.code)
    ) {
      return [{ id: String(event.object_id), activity: null }];
    }

    throw error;
  }
}

export async function processStravaRemovalEvent(
  event: StravaWebhookEvent,
  job: StravaJob,
): Promise<ActivityWrite[]> {
  if (event.object_type === "activity") {
    return processActivityEvent(event, job);
  }

  if (![false, "false"].includes(event.updates?.authorized ?? "")) {
    return [];
  }

  const connection = await currentConnection(job);

  if (!connection || connection.athlete_id !== String(event.owner_id)) {
    return [];
  }

  try {
    if (!connection.access_token) {
      return [];
    }

    try {
      await verifyStravaAuthorization(
        await decryptToken(connection.access_token),
        connection.athlete_id!,
      );
    } catch (error) {
      if (!(error instanceof StravaError) || error.code !== "reauth_required") {
        throw error;
      }

      const access = await getUserStravaAccessToken(connection.user_id, true);

      if (!access) {
        return [];
      }

      await verifyStravaAuthorization(access, connection.athlete_id!);
    }

    return [];
  } catch (error) {
    if (!(error instanceof StravaError) || error.code !== "authorization_revoked") {
      throw error;
    }

    await stravaRpc("strava_provider_revoked", {
      p_user: job.user_id,
      p_generation: job.generation,
    });

    return [];
  }
}

async function revokeConnection(userId: string): Promise<boolean> {
  const claimed = await stravaRpc<(StravaConnection & { busy?: boolean }) | null>(
    "strava_claim_credentials",
    { p_user: userId, p_kind: "revoke" },
  );

  if (!claimed) {
    return (await loadStravaConnection(userId))?.status === "disconnected";
  }

  if (claimed.busy) {
    return false;
  }

  try {
    if (claimed.credentials_uncertain) {
      throw new StravaError("revocation_needs_authorization", 409);
    }

    if (claimed.refresh_token) {
      await revokeStravaAccess(await decryptToken(claimed.refresh_token));
    }

    return await stravaRpc<boolean>("strava_finish_disconnect", {
      p_user: userId,
      p_generation: claimed.generation,
      p_operation: claimed.operation_id,
    });
  } finally {
    await stravaRpc("strava_release_credentials", {
      p_user: userId,
      p_operation: claimed.operation_id,
    });
  }
}

export async function disconnectStravaUser(
  userId: string,
): Promise<"disconnected" | "disconnecting" | "reauthorize_to_disconnect"> {
  await stravaRpc("strava_disconnect", { p_user: userId });

  try {
    return await revokeConnection(userId) ? "disconnected" : "disconnecting";
  } catch (error) {
    if (
      error instanceof StravaError &&
      error.code === "revocation_needs_authorization"
    ) {
      return "reauthorize_to_disconnect";
    }

    return "disconnecting"; // Local ingestion is already disabled; the durable revoke job retries.
  }
}

export async function processStravaJobs(limit = 10): Promise<void> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new StravaError("invalid_job_limit", 400);
  }

  // Leave room within the 60-second handler for a final job's provider retry.
  const deadline = Date.now() + 20000;

  for (let i = 0; i < limit && Date.now() < deadline; i++) {
    const job = await stravaRpc<StravaJob | null>("strava_claim_job");

    if (!job) {
      return;
    }

    try {
      let activities: ActivityWrite[] = [];
      let continuation: {
        key: string;
        payload: Record<string, unknown>;
      } | null = null;
      const discoveries: {
        object_id: string;
        owner_id: string;
        runner_id: string;
      }[] = [];

      if (job.kind === "revoke") {
        if (!await revokeConnection(job.user_id)) {
          throw new StravaError("connection_busy", 409, 3);
        }
      } else if (job.kind === "backfill") {
        const connection = await currentConnection(job);

        const attachments = connection ? await currentJobAttachments(job) : null;
        const runner = attachments?.find(({ runner_id }) => runner_id === job.payload.runner_id)?.runner_id;
        const [race] = runner ? await loadRunnerRaceConfigs(job.user_id, runner) : [];
        if (connection && race && job.payload.runner_id === runner) {
          const { after, before, page } = job.payload as {
            after: number;
            before: number;
            page: number;
          };
          if (after !== Math.floor(Date.parse(race.config.startTimeFrom) / 1000) - 1 ||
            before !== Math.ceil(Date.parse(race.config.startTimeTo) / 1000) + 1) throw new StravaError("invalid_window", 400);
          const listed = await withAccess(connection, (access) =>
            listStravaActivities(access, after, before, page, connection.athlete_id!),
          );

          // Fetch each detail through the normal queue, not this potentially stale summary page.
          for (const activity of listed) {
            discoveries.push({
              object_id: activity.id,
              owner_id: connection.athlete_id!,
              runner_id: runner!,
            });
          }

          if (listed.length === 25) {
            if (page >= 10000) {
              throw new StravaError("backfill_page_limit", 422);
            }

            continuation = {
              key: `${typeof job.payload.runner_id === "string" ? `runner:${job.payload.runner_id}:` : ""}backfill:${after}:${before}:${page + 1}`,
              payload: { ...job.payload, after, before, page: page + 1 },
            };
          }
        }
      } else if (job.kind === "activity") {
        activities = await processActivityEvent(
          {
            object_id: stravaId(job.payload.object_id),
            owner_id: stravaId(job.payload.owner_id),
          },
          job,
        );
      } else {
        const event = validateStravaWebhookEvent(job.payload);

        if (event.object_type === "athlete" || event.aspect_type === "delete") {
          activities = await processStravaRemovalEvent(event, job);
        } else {
          activities = await processActivityEvent(event, job);
        }
      }

      const attachments = job.kind === "revoke" || !await currentConnection(job)
        ? [] : await currentJobAttachments(job);
      if (attachments === null) {
        activities = [];
        continuation = null;
        discoveries.length = 0;
      }
      const races = (await Promise.all((attachments ?? []).map(({ runner_id }) => loadRunnerRaceConfigs(job.user_id, runner_id)))).flat();
      const retained = new Set<string>();
      const runnerCandidates = races.map(({ runnerId, config }) => ({
        runner_id: runnerId,
        candidates: activities.flatMap(({ activity }) => {
          if (!activity) return [];
          const match = matchActivityToRace(activity, config);
          if (match.status !== "no_match") retained.add(activity.id);
          return [{ activity_id: activity.id, match_status: match.status, reason: match.reason,
            summary: match.status === "no_match" ? {} : {
              startDate: activity.startDate,
              distanceMeters: activity.distanceMeters,
              gpsAvailable: activity.startLatLng !== null,
            } }];
        }),
      }));
      // Null is a minimal invalidation: SQL removes any prior snapshot/selection
      // and does not create rows for unrelated workouts never retained here.
      const storedActivities = activities.map(({ id, activity }) => ({
        id,
        activity: activity && retained.has(id) ? toStoredStravaActivity(activity) : null,
      }));
      await stravaRpc("strava_commit_runner_job", {
        p_job: job.id,
        p_lease: job.lease_id,
        p_activities: storedActivities,
        p_continuation: continuation,
        p_discoveries: discoveries,
        p_runner_candidates: runnerCandidates,
      });
    } catch (error) {
      const known = error instanceof StravaError;
      const code = known ? error.code : "storage_unavailable";

      if (code === "authorization_revoked") {
        await stravaRpc("strava_provider_revoked", {
          p_user: job.user_id,
          p_generation: job.generation,
        });
      }

      const permanent =
        known &&
        [
          "reauth_required",
          "authorization_revoked",
          "revocation_needs_authorization",
          "athlete_mismatch",
          "activity_mismatch",
          "invalid_webhook",
          "invalid_window",
          "invalid_id",
          "backfill_page_limit",
          "provider_rejected",
          "invalid_provider_response",
          "invalid_encrypted_token",
        ].includes(code);
      const delay = permanent
        ? null
        : known && error.retryAfter
          ? error.retryAfter
          : Math.min(3600, 5 * 2 ** Math.min(job.attempts, 10)) + crypto.randomInt(5);

      await stravaRpc("strava_commit_job", {
        p_job: job.id,
        p_lease: job.lease_id,
        p_error: code,
        p_delay: delay,
        p_reauth: code === "reauth_required",
      });
    }
  }
}

export async function requireStravaRunnerAccess(userId: string, runnerId: string, signal?: AbortSignal): Promise<void> {
  if (!isRunnerId(runnerId)) {
    throw new StravaError("invalid_runner", 400);
  }

  const query = getSupabaseAdmin()
    .from("runner_access")
    .select("runner_id")
    .eq("user_id", userId)
    .eq("runner_id", runnerId);
  const { data, error } = await (signal ? query.abortSignal(signal) : query).maybeSingle();

  if (error) {
    throw new Error("Strava storage is temporarily unavailable.");
  }

  if (!data) {
    throw new StravaError("runner_not_found", 404);
  }
}

export async function attachRunnerToStrava(userId: string, runnerId: string): Promise<RunnerStravaRoute> {
  await requireStravaRunnerAccess(userId, runnerId);
  const connection = await loadStravaConnection(userId);
  if (!connection || connectionState(connection) || !connection.granted_scopes.includes("activity:read_all")) {
    throw new StravaError("not_connected", 409);
  }
  const result = await stravaRpc<string>("strava_attach_runner", { p_user: userId, p_runner: runnerId });
  if (result === "forbidden") throw new StravaError("runner_not_found", 404);
  if (result === "connection_required") throw new StravaError("not_connected", 409);
  if (result !== "attached") throw new StravaError("temporarily_unavailable");
  await enqueueRunnerStravaBackfill(userId, runnerId);
  return getRunnerStravaRoute(userId, runnerId);
}

export async function detachRunnerFromStrava(userId: string, runnerId: string): Promise<"detached"> {
  await requireStravaRunnerAccess(userId, runnerId);
  const result = await stravaRpc<string>("strava_detach_runner", { p_user: userId, p_runner: runnerId });
  if (result === "forbidden") throw new StravaError("runner_not_found", 404);
  if (result !== "detached") throw new StravaError("temporarily_unavailable");
  return "detached";
}

function connectionState(connection: StravaConnection | null): RunnerStravaRoute["status"] | null {
  if (!connection || connection.status === "disconnected") return "disconnected";
  if (connection.status === "disconnecting") {
    return connection.credentials_uncertain ? "reauthorize_to_disconnect" : "disconnecting";
  }
  if (connection.status === "reauth_required") return "reauth_required";
  return connection.athlete_id ? null : "unavailable";
}

const emptyRunnerState = (status: RunnerStravaRoute["status"]): RunnerStravaRoute => ({
  status, activityId: null, candidates: [], metrics: {},
});

type CandidateRow = { activity_id: string; match_status: string; reason: string; summary: unknown };

function candidateDisplay(value: unknown) {
  if (value === null || typeof value !== "object") return null;
  const { startDate, distanceMeters, gpsAvailable } = value as Record<string, unknown>;
  if (typeof startDate !== "string" || !/(Z|[+-]\d{2}:\d{2})$/.test(startDate) ||
    typeof distanceMeters !== "number" || !Number.isFinite(distanceMeters) || distanceMeters < 0) return null;

  // Provider dates represent UTC instants. Candidates are shown in Jakarta time.
  const local = new Date(Date.parse(startDate) + 7 * 60 * 60 * 1000);
  if (!Number.isFinite(local.getTime())) return null;
  return {
    startTimeLocal: local.toISOString().slice(0, 19) + "+07:00",
    distanceMeters,
    gpsAvailable: typeof gpsAvailable === "boolean" ? gpsAvailable : null,
  };
}

function safeCandidate(row: CandidateRow, activity: StoredStravaActivity, athleteId: string): RunnerStravaCandidate | null {
  if (activity.id !== row.activity_id || activity.athleteId !== athleteId || activity.sportType !== "Run" ||
    !/^[1-9]\d{0,18}$/.test(activity.id)) return null;
  const display = candidateDisplay(row.summary) ?? candidateDisplay(activity);
  if (!display) return null;

  const knownReasons = ["race_checks_passed", "missing_start_location", "missing_configured_location"];
  const gpsAvailable = display.gpsAvailable ?? (activity.gpsAvailable === true);
  return {
    activityId: activity.id, startTimeLocal: display.startTimeLocal, distanceMeters: display.distanceMeters,
    sportType: "Run", gpsAvailable: row.reason !== "missing_start_location" && gpsAvailable,
    matchReason: knownReasons.includes(row.reason) ? row.reason : "confirmation_required",
  };
}

export async function getRunnerStravaRoute(userId: string, runnerId: string, signal?: AbortSignal): Promise<RunnerStravaRoute> {
  await requireStravaRunnerAccess(userId, runnerId, signal);
  const connection = await loadStravaConnection(userId, signal);
  const state = connectionState(connection);
  if (state) return emptyRunnerState(state);
  const active = connection!;
  const attachment = await loadStravaRunnerAttachment(userId, active.generation, runnerId, signal);
  if (!attachment) return emptyRunnerState("disconnected");
  const db = getSupabaseAdmin();
  const scoped = <const Fields extends string>(table: string, fields: Fields) => {
    const query = db.from(table).select(fields).eq("user_id", userId).eq("generation", active.generation);
    return signal ? query.abortSignal(signal) : query;
  };
  const batchSize = 100;
  const loadCandidates = async () => {
    const rows: CandidateRow[] = [];
    for (let offset = 0; ; offset += batchSize) {
      const page = await scoped("strava_activity_candidates", "activity_id,match_status,reason,summary")
        .eq("runner_id", runnerId).in("match_status", ["auto_match", "needs_confirmation"])
        .order("activity_id").range(offset, offset + batchSize - 1);
      if (page.error) throw new Error("Strava storage is temporarily unavailable.");
      rows.push(...page.data ?? []);
      if (!page.data || page.data.length < batchSize) return rows;
    }
  };
  const [candidateRows, selection, jobs] = await Promise.all([
    loadCandidates(),
    scoped("strava_runner_activities", "activity_id").eq("runner_id", runnerId).maybeSingle(),
    scoped("strava_jobs", "kind,status,payload").in("kind", ["backfill", "activity", "webhook"]).neq("status", "complete"),
  ]);
  if (selection.error || jobs.error) {
    throw new Error("Strava storage is temporarily unavailable.");
  }
  // Unrelated imported activities must not consume the database response limit.
  // Small ID batches also keep each detail request below that limit and bound its URL.
  const details = await Promise.all(Array.from({ length: Math.ceil(candidateRows.length / batchSize) }, (_, index) =>
    scoped("strava_activities", "activity_id,activity").in("activity_id",
      candidateRows.slice(index * batchSize, (index + 1) * batchSize).map((row) => row.activity_id))));
  if (details.some((result) => result.error)) throw new Error("Strava storage is temporarily unavailable.");
  const activities = new Map<string, StoredStravaActivity>(details.flatMap((result) => result.data ?? []).flatMap((row) =>
    row.activity ? [[row.activity_id, row.activity as StoredStravaActivity] as const] : []));
  const candidates: RunnerStravaCandidate[] = candidateRows.flatMap((row) => {
    const activity = activities.get(row.activity_id);
    const summary = activity ? safeCandidate(row, activity, active.athlete_id!) : null;
    return summary ? [summary] : [];
  }).sort((a, b) => a.activityId.localeCompare(b.activityId));
  const selected = candidates.find((candidate) => candidate.activityId === selection.data?.activity_id);
  let metrics: RunnerStravaRoute["metrics"] = {};
  if (selected) {
    const result = await scoped("strava_live_metrics", "avg_heartrate,max_heartrate,elevation_gain_m,calories,avg_cadence")
      .eq("runner_id", runnerId).eq("activity_id", selected.activityId).maybeSingle();
    if (result.error) throw new Error("Strava storage is temporarily unavailable.");
    metrics = availableMetrics(result.data ?? {});
  }
  // A disconnect/reconnect during the reads must not return an old generation's data.
  const current = await loadStravaConnection(userId, signal);
  const currentState = connectionState(current);
  if (currentState) return emptyRunnerState(currentState);
  if (current!.generation !== active.generation) return emptyRunnerState("importing");
  const currentAttachment = await loadStravaRunnerAttachment(userId, active.generation, runnerId, signal);
  if (!currentAttachment) return emptyRunnerState("disconnected");
  if (currentAttachment.attachment_id !== attachment.attachment_id) return emptyRunnerState("importing");
  const runnerJobs = jobs.data?.filter((job) => job.kind === "webhook" ||
    !job.payload?.runner_id || job.payload.runner_id === runnerId);
  return {
    status: selected ? "matched" : runnerJobs?.some((job) => job.status === "failed") ? "unavailable"
      : runnerJobs?.length ? "importing" : candidates.length ? "needs_confirmation" : "no_match",
    activityId: selected?.activityId ?? null, candidates, metrics,
  };
}

export async function confirmRunnerStravaActivity(userId: string, runnerId: string, activityId: string): Promise<RunnerStravaRoute> {
  await requireStravaRunnerAccess(userId, runnerId);
  if (typeof activityId !== "string" || !/^[1-9]\d{0,18}$/.test(activityId)) throw new StravaError("invalid_activity", 400);
  const connection = await loadStravaConnection(userId);
  if (!connection || connectionState(connection)) throw new StravaError("not_connected", 409);
  if (!await loadStravaRunnerAttachment(userId, connection.generation, runnerId)) throw new StravaError("not_connected", 409);
  const db = getSupabaseAdmin();
  const [candidate, detail] = await Promise.all([
    db.from("strava_activity_candidates").select("activity_id,match_status,reason,summary")
      .eq("user_id", userId).eq("generation", connection.generation).eq("runner_id", runnerId)
      .eq("activity_id", activityId).in("match_status", ["auto_match", "needs_confirmation"]).maybeSingle(),
    db.from("strava_activities").select("activity").eq("user_id", userId)
      .eq("generation", connection.generation).eq("activity_id", activityId).maybeSingle(),
  ]);
  if (candidate.error || detail.error) throw new Error("Strava storage is temporarily unavailable.");
  const activity = detail.data?.activity as StoredStravaActivity | undefined;
  if (!candidate.data || !activity || !safeCandidate(candidate.data, activity, connection.athlete_id!)) {
    throw new StravaError("invalid_candidate", 409);
  }
  // Recheck identity and derive metrics from the current stored detail under the
  // database connection/candidate locks, so a worker refresh cannot race this read.
  const outcome = await stravaRpc<string>("strava_confirm_runner_activity", {
    p_user: userId, p_generation: connection.generation, p_runner: runnerId, p_activity: activityId,
  });
  if (outcome === "forbidden") throw new StravaError("runner_not_found", 404);
  if (outcome === "activity_already_selected") throw new StravaError("activity_already_selected", 409);
  if (outcome === "obsolete" || outcome === "invalid_candidate") throw new StravaError("invalid_candidate", 409);
  if (outcome !== "selected") throw new StravaError("temporarily_unavailable");
  return getRunnerStravaRoute(userId, runnerId);
}
