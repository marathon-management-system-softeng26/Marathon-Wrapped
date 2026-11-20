import "server-only";
import { AccessDeniedError } from "@/lib/auth/access";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import type { Photo, StravaFirstWrappedPayload } from "@/lib/wrappedPayload";
import { getStravaWrappedForUser } from "@/lib/stravaWrappedService";
import type { OfficialRecap } from "@/lib/officialResults/types";
export type { OfficialRecap } from "@/lib/officialResults/types";

export type OfficialWrappedPayload = {
  kind: "official";
  result: OfficialRecap;
  strava: StravaFirstWrappedPayload | { state: "unavailable" };
  photos: Photo[];
};

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
  result: OfficialRecap,
  strava: OfficialWrappedPayload["strava"],
  photos: Photo[],
): OfficialWrappedPayload {
  return { kind: "official", result, strava, photos };
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
  if (error) throw new Error("Official results are temporarily unavailable.");
  if (!data) return null;
  const result = normalizeRow(data as OfficialRow);
  const { data: photos, error: photoError } = await db
    .from("fotoyu_photos")
    .select("id,bib_number,photo_url,photographer,captured_km,captured_at")
    .eq("bib_number", result.bib);
  if (photoError) throw new Error("Official photos are temporarily unavailable.");
  let strava: OfficialWrappedPayload["strava"] = { state: "unavailable" };
  try {
    strava = await getStravaWrappedForUser(userId, runnerId);
  } catch {
    // Official results are the source of truth; optional enrichment must not hide them.
  }
  return composeOfficialWrapped(result, strava, (photos ?? []) as Photo[]);
}
