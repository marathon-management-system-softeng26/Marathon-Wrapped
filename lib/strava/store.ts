import "server-only";
import { getSupabaseAdmin } from "../supabaseServer";
import { validateRaceMatchConfig, type RaceMatchConfig } from "./matching";

export type RunnerRaceConfig = { runnerId: string; config: RaceMatchConfig };

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
