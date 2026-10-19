import "server-only";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import type { Enrichment, Photo, StravaMetrics } from "@/lib/wrappedPayload";

/** Persisted optional data only; never await an external provider for baseline reads. */
export async function getRunnerEnrichment(runnerId: string, bib: string | null, signal: AbortSignal): Promise<Enrichment> {
  const db = getSupabaseAdmin();
  const warnings: string[] = [];
  const [strava, photos] = await Promise.all([
    db.from("strava_metrics").select("avg_heartrate,max_heartrate,elevation_gain_m,calories,avg_cadence,data_source").eq("runner_id", runnerId).abortSignal(signal).maybeSingle(),
    bib === null ? Promise.resolve({ data: [], error: null }) : db.from("fotoyu_photos")
      .select("id,bib_number,photo_url,photographer,captured_km,captured_at").eq("bib_number", bib).order("captured_at", { ascending: true }).abortSignal(signal),
  ]);
  if (strava.error) warnings.push("Extra activity details are unavailable. Your chip recap is ready.");
  if (photos.error) warnings.push("Photos are unavailable. Try again later.");
  let metrics: StravaMetrics | null = null;
  if (!strava.error && strava.data) {
    const number = (value: unknown): number | null => {
      if (value === null || value === undefined) return null;
      const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
      return Number.isFinite(n) && n >= 0 ? n : null;
    };
    metrics = {
      avg_heartrate: number(strava.data.avg_heartrate), max_heartrate: number(strava.data.max_heartrate),
      elevation_gain_m: number(strava.data.elevation_gain_m), calories: number(strava.data.calories), avg_cadence: number(strava.data.avg_cadence),
    };
  }
  return {
    strava: { state: strava.error ? "unavailable" : !metrics ? "disconnected" : strava.data?.data_source === "strava" ? "connected" : "demo", metrics },
    photos: (photos.error ? [] : photos.data ?? []) as Photo[], warnings,
  };
}
