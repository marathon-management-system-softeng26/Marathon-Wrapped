import "server-only";
import { AccessDeniedError } from "@/lib/auth/access";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { toOrganizerPhoto, type OfficialWrappedPayload, type Photo, type WrappedRegistration } from "@/lib/wrappedPayload";
import { getStravaWrappedForUser } from "@/lib/stravaWrappedService";
import { getWrappedForUser } from "@/lib/wrappedService";
import type { OfficialRecap } from "@/lib/officialResults/types";
export type { OfficialRecap } from "@/lib/officialResults/types";

type OfficialRow = {
  runner_id: string;
  event_id: number;
  bib: string; name: string; distance: "5K" | "10K";
  status: OfficialRecap["status"];
  gender: string | null; division: string | null;
  finish_time_ms: number | null; net_time_ms: number | null;
  overall_rank: number | null; division_rank: number | null; gender_rank: number | null;
  source_url: string | null;
  official_race_checkpoints?: Array<{
    sequence: number;
    label: string;
    distance_meters: number | null;
    displayed_time_ms: number | null;
    reported_split_ms: number | null;
    reference_label: string | null;
  }> | null;
};

export function composeOfficialWrapped(
  registration: WrappedRegistration,
  result: OfficialRecap,
  strava: OfficialWrappedPayload["strava"],
  photos: Photo[],
): OfficialWrappedPayload {
  return { kind: "official", registration, result, strava, photos };
}

function normalizeRow(row: OfficialRow): OfficialRecap {
  return {
    runnerId: row.runner_id,
    eventId: row.event_id,
    bib: row.bib,
    name: row.name,
    distance: row.distance,
    status: row.status,
    finishTimeMs: row.finish_time_ms,
    netTimeMs: row.net_time_ms,
    overallRank: row.overall_rank,
    division: row.division,
    divisionRank: row.division_rank,
    gender: row.gender,
    genderRank: row.gender_rank,
    checkpoints: (row.official_race_checkpoints ?? []).map((checkpoint) => ({
      sequence: checkpoint.sequence,
      label: checkpoint.label,
      distanceMeters: checkpoint.distance_meters,
      displayedTimeMs: checkpoint.displayed_time_ms,
      reportedSplitMs: checkpoint.reported_split_ms,
      referenceLabel: checkpoint.reference_label,
    })),
    sourceUrl: row.source_url,
  };
}

async function loadLegacyOfficial(userId: string, runnerId: string): Promise<OfficialWrappedPayload | null> {
  const legacy = await getWrappedForUser(userId, runnerId);
  if (!legacy || legacy.status === "unavailable") return null;
  const { stats } = legacy;
  const registration = await loadRegistration(runnerId);
  let elapsedMs = 0;
  const checkpoints = stats.splits.map((split, index) => {
    const splitMs = split.split_seconds * 1_000;
    elapsedMs += splitMs;
    return { sequence: index + 1, label: `${split.km_marker}K`, distanceMeters: split.km_marker * 1_000, displayedTimeMs: elapsedMs, reportedSplitMs: splitMs, referenceLabel: null };
  });
  const finished = legacy.status === "finisher";
  const result: OfficialRecap = {
    runnerId, eventId: 0, bib: stats.bib_number ?? "", name: stats.name, distance: stats.category,
    status: ({ finisher: "finished", dnf: "dnf", dns: "dns" } as const)[legacy.status], finishTimeMs: finished && stats.elapsed_seconds !== null ? stats.elapsed_seconds * 1_000 : null,
    netTimeMs: finished && stats.elapsed_seconds !== null ? stats.elapsed_seconds * 1_000 : null,
    overallRank: finished ? stats.overall_rank : null, division: stats.category,
    divisionRank: finished ? stats.category_rank : null, gender: stats.gender, genderRank: null,
    checkpoints: finished ? checkpoints : [], sourceUrl: null,
  };
  let strava: OfficialWrappedPayload["strava"] = { state: "unavailable" };
  try { strava = await getStravaWrappedForUser(userId, runnerId); } catch { /* optional */ }
  return composeOfficialWrapped(registration, result, strava, legacy.photos);
}

async function loadRegistration(runnerId: string): Promise<WrappedRegistration> {
  const { data, error } = await getSupabaseAdmin()
    .from("runners")
    .select("id,name,bib_number,categories(name,events(name,event_date))")
    .eq("id", runnerId)
    .maybeSingle<{
      id: string;
      name: string;
      bib_number: string | null;
      categories: { name: string; events: { name: string; event_date: string } };
    }>();
  if (error) throw new Error("Official registration is temporarily unavailable.");
  if (!data) throw new AccessDeniedError();
  return {
    runner: { id: data.id, name: data.name, bibNumber: data.bib_number },
    event: {
      name: data.categories.events.name,
      date: data.categories.events.event_date,
      category: data.categories.name,
    },
  };
}

export async function getOfficialWrappedForUser(
  userId: string,
  runnerId: string,
  alreadyAuthorized = false,
): Promise<OfficialWrappedPayload | null> {
  const db = getSupabaseAdmin();
  if (!alreadyAuthorized) {
    const access = await db.from("runner_access").select("runner_id").eq("user_id", userId).eq("runner_id", runnerId).maybeSingle();
    if (access.error) throw new Error("Access verification is unavailable.");
    if (!access.data) throw new AccessDeniedError();
  }
  const { data, error } = await db
    .from("official_race_results")
    .select("runner_id,event_id,bib,name,distance,status,finish_time_ms,net_time_ms,overall_rank,division,division_rank,gender,gender_rank,source_url,official_race_checkpoints(sequence,label,distance_meters,displayed_time_ms,reported_split_ms,reference_label)")
    .eq("runner_id", runnerId)
    .maybeSingle();
  if (error || !data) return loadLegacyOfficial(userId, runnerId);
  const result = normalizeRow(data as OfficialRow);
  const [registration, photoResult] = await Promise.all([
    loadRegistration(runnerId),
    db.from("fotoyu_photos")
      .select("id,bib_number,photo_url,photographer,captured_km,captured_at")
      .eq("runner_id", runnerId),
  ]);
  const { data: photos, error: photoError } = photoResult;
  if (photoError) throw new Error("Official photos are temporarily unavailable.");
  let strava: OfficialWrappedPayload["strava"] = { state: "unavailable" };
  try {
    strava = await getStravaWrappedForUser(userId, runnerId);
  } catch {
    // Official results are the source of truth; optional enrichment must not hide them.
  }
  return composeOfficialWrapped(registration, result, strava, (photos ?? []).map(toOrganizerPhoto));
}
