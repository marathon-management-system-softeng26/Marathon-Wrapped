import "server-only";
import { getSupabaseAdmin } from "../supabaseServer";
import type { StravaActivity } from "./client";
import { validateRaceMatchConfig, type RaceMatchConfig } from "./matching";

export type RunnerRaceConfig = { runnerId: string; config: RaceMatchConfig };

export type StravaRunnerAttachment = { runner_id: string; created_at: string; attachment_id: string };

export type StoredStravaActivity = Omit<StravaActivity, "startLatLng"> & { gpsAvailable: boolean };

/** Older cache rows predate normalized timing and split fields. */
export function isCompleteStoredStravaActivity(value: unknown, id: string, athleteId: string): value is StoredStravaActivity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const finiteNonnegative = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0;
  const optionalMetric = (n: unknown) => n === null || finiteNonnegative(n);
  if (row.id !== id || row.athleteId !== athleteId || row.sportType !== "Run" || typeof row.startDate !== "string" ||
    !Number.isFinite(Date.parse(row.startDate)) || !finiteNonnegative(row.distanceMeters) ||
    !Number.isSafeInteger(row.movingTimeSeconds) || !Number.isSafeInteger(row.elapsedTimeSeconds) ||
    !finiteNonnegative(row.movingTimeSeconds) || !finiteNonnegative(row.elapsedTimeSeconds) ||
    (row.movingTimeSeconds as number) > (row.elapsedTimeSeconds as number) || typeof row.gpsAvailable !== "boolean" ||
    ![row.averageSpeedMps, row.maxSpeedMps, row.averageHeartrate, row.maxHeartrate, row.elevationGainMeters, row.calories, row.averageCadence].every(optionalMetric)) return false;
  if (row.metricSplits === null) return true;
  if (!Array.isArray(row.metricSplits) || row.metricSplits.length > 256) return false;
  const markers = new Set<number>();
  return row.metricSplits.every((split: unknown) => {
    if (!split || typeof split !== "object" || Array.isArray(split)) return false;
    const s = split as Record<string, unknown>;
    if (!Number.isSafeInteger(s.kilometer) || (s.kilometer as number) < 1 || markers.has(s.kilometer as number) ||
      !Number.isSafeInteger(s.movingSeconds) || !Number.isSafeInteger(s.elapsedSeconds) ||
      !finiteNonnegative(s.movingSeconds) || !finiteNonnegative(s.elapsedSeconds) ||
      (s.movingSeconds as number) > (s.elapsedSeconds as number) || !finiteNonnegative(s.distanceMeters) ||
      !optionalMetric(s.averageSpeedMps)) return false;
    markers.add(s.kilometer as number);
    return true;
  });
}

export function toStoredStravaActivity(activity: StravaActivity): StoredStravaActivity {
  return {
    id: activity.id,
    athleteId: activity.athleteId,
    sportType: activity.sportType,
    startDate: activity.startDate,
    distanceMeters: activity.distanceMeters,
    movingTimeSeconds: activity.movingTimeSeconds,
    elapsedTimeSeconds: activity.elapsedTimeSeconds,
    averageSpeedMps: activity.averageSpeedMps,
    maxSpeedMps: activity.maxSpeedMps,
    metricSplits: activity.metricSplits?.map((split) => ({
      kilometer: split.kilometer,
      elapsedSeconds: split.elapsedSeconds,
      movingSeconds: split.movingSeconds,
      distanceMeters: split.distanceMeters,
      averageSpeedMps: split.averageSpeedMps,
    })) ?? null,
    averageHeartrate: activity.averageHeartrate,
    maxHeartrate: activity.maxHeartrate,
    elevationGainMeters: activity.elevationGainMeters,
    calories: activity.calories,
    averageCadence: activity.averageCadence,
    gpsAvailable: activity.startLatLng !== null,
  };
}

/** Consent survives OAuth history cleanup, but never a detach or generation change. */
export async function loadStravaRunnerAttachments(userId: string, generation: string, signal?: AbortSignal): Promise<StravaRunnerAttachment[]> {
  const query = getSupabaseAdmin().from("strava_runner_attachments").select("runner_id,created_at,attachment_id")
    .eq("user_id", userId).eq("generation", generation).eq("status", "active");
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error) throw new Error("Strava storage is temporarily unavailable.");
  return data ?? [];
}

export async function loadStravaRunnerAttachment(userId: string, generation: string, runnerId: string, signal?: AbortSignal): Promise<StravaRunnerAttachment | null> {
  const query = getSupabaseAdmin().from("strava_runner_attachments").select("runner_id,created_at,attachment_id")
    .eq("user_id", userId).eq("generation", generation).eq("runner_id", runnerId).eq("status", "active");
  const { data, error } = await (signal ? query.abortSignal(signal) : query).maybeSingle();
  if (error) throw new Error("Strava storage is temporarily unavailable.");
  return data;
}

/** Only direct runner ownership can authorize athlete data; organizer access is insufficient. */
export async function loadRunnerRaceConfigs(userId: string, runnerId?: string): Promise<RunnerRaceConfig[]> {
  const db = getSupabaseAdmin();
  const accessQuery = db.from("runner_access").select("runner_id").eq("user_id", userId);
  const access = runnerId
    ? await accessQuery.eq("runner_id", runnerId).maybeSingle()
    : await accessQuery;
  if (access.error) throw new Error("Strava storage is temporarily unavailable.");
  if (!access.data) return [];
  const runners = Array.isArray(access.data) ? access.data : [access.data];
  const result: RunnerRaceConfig[] = [];
  for (const runner of runners) {
    const registration = await db.from("runners").select("category_id").eq("id", runner.runner_id).maybeSingle();
    if (registration.error) throw new Error("Strava storage is temporarily unavailable.");
    if (!registration.data) continue;
    const [category, race] = await Promise.all([
      db.from("categories").select("distance_km").eq("id", registration.data.category_id).maybeSingle(),
      db.from("strava_race_configs").select("*").eq("category_id", registration.data.category_id).maybeSingle(),
    ]);
    if (category.error || race.error) throw new Error("Strava storage is temporarily unavailable.");
    if (!category.data || !race.data) continue;
    result.push({ runnerId: runner.runner_id, config: validateRaceMatchConfig({
      startTimeFrom: race.data.start_time_from,
      startTimeTo: race.data.start_time_to,
      startLatitude: race.data.start_latitude,
      startLongitude: race.data.start_longitude,
      startRadiusMeters: race.data.start_radius_m,
      distanceMeters: Number(category.data.distance_km) * 1000,
      allowedSportTypes: race.data.allowed_sport_types,
    }) });
  }
  return result;
}

export async function stravaRpc<T>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await getSupabaseAdmin().rpc(name, args);

  if (error) {
    throw new Error("Strava storage is temporarily unavailable.");
  }

  return data as T;
}
