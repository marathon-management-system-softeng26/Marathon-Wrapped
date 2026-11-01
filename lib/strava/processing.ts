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
import { stravaRpc } from "./store";

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
    | "pending"
    | "matched"
    | "needs_confirmation"
    | "no_match"
    | "no_gps"
    | "unavailable";
  activityId: string | null;
  polyline: string | null;
};

type StravaJob = {
  id: string;
  user_id: string;
  generation: string;
  kind: "webhook" | "activity" | "backfill" | "revoke";
  payload: Record<string, unknown>;
  lease_id: string;
  attempts: number;
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

  await stravaRpc("strava_enqueue", {
    p_user: userId,
    p_generation: connection.generation,
    p_kind: "backfill",
    p_key: `backfill:${after}:${before}:1`,
    p_payload: { after, before, page: 1 },
  });
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
        payload: Record<string, number>;
      } | null = null;
      const discoveries: {
        object_id: string;
        owner_id: string;
      }[] = [];

      if (job.kind === "revoke") {
        if (!await revokeConnection(job.user_id)) {
          throw new StravaError("connection_busy", 409, 3);
        }
      } else if (job.kind === "backfill") {
        const connection = await currentConnection(job);

        if (connection) {
          const { after, before, page } = job.payload as {
            after: number;
            before: number;
            page: number;
          };
          const listed = await withAccess(connection, (access) =>
            listStravaActivities(access, after, before, page, connection.athlete_id!),
          );

          // Fetch each detail through the normal queue, not this potentially stale summary page.
          for (const activity of listed) {
            discoveries.push({
              object_id: activity.id,
              owner_id: connection.athlete_id!,
            });
          }

          if (listed.length === 25) {
            if (page >= 10000) {
              throw new StravaError("backfill_page_limit", 422);
            }

            continuation = {
              key: `backfill:${after}:${before}:${page + 1}`,
              payload: { after, before, page: page + 1 },
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

      await stravaRpc("strava_commit_job", {
        p_job: job.id,
        p_lease: job.lease_id,
        p_activities: activities,
        p_continuation: continuation,
        p_discoveries: discoveries,
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

export async function getRunnerStravaRoute(
  userId: string,
  runnerId: string,
): Promise<RunnerStravaRoute> {
  if (!isRunnerId(runnerId)) {
    throw new StravaError("invalid_runner", 400);
  }

  const { data, error } = await getSupabaseAdmin()
    .from("runner_access")
    .select("runner_id")
    .eq("user_id", userId)
    .eq("runner_id", runnerId)
    .maybeSingle();

  if (error) {
    throw new Error("Strava storage is temporarily unavailable.");
  }

  if (!data) {
    throw new StravaError("runner_not_found", 404);
  }

  const connection = await loadStravaConnection(userId);

  // TODO: Read selected routes here when race matching and candidate persistence are implemented.
  return {
    status: connection?.status === "active" ? "unavailable" : "disconnected",
    activityId: null,
    polyline: null,
  };
}

export async function confirmRunnerStravaActivity(): Promise<never> {
  throw new StravaError("matching_not_implemented", 501);
}
