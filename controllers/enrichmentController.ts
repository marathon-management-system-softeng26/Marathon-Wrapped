import "server-only";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { getRunnerStravaRoute } from "@/lib/strava/processing";
import { StravaError } from "@/lib/strava/client";
import type { Enrichment, Photo, StravaMetrics, WrappedPayloadStrava } from "@/lib/wrappedPayload";

const fields = "avg_heartrate,max_heartrate,elevation_gain_m,calories,avg_cadence";
function stopOnAbort<T>(source: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("Optional data deadline exceeded.", "AbortError"));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(source).then(
      (value) => { signal.removeEventListener("abort", abort); resolve(value); },
      (error) => { signal.removeEventListener("abort", abort); reject(error); },
    );
  });
}
function metrics(row: Partial<StravaMetrics>): StravaMetrics {
  const number = (value: unknown): number | null => {
    const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  return { avg_heartrate: number(row.avg_heartrate), max_heartrate: number(row.max_heartrate),
    elevation_gain_m: number(row.elevation_gain_m), calories: number(row.calories), avg_cadence: number(row.avg_cadence) };
}

/** Stored optional data only. Live reads use direct ownership and current selected activity checks. */
export async function getRunnerEnrichment(runnerId: string, bib: string | null, signal: AbortSignal, userId?: string): Promise<Enrichment> {
  const db = getSupabaseAdmin();
  const [demo, photos, live] = await Promise.allSettled([
    stopOnAbort(db.from("strava_metrics").select(`${fields},data_source`).eq("runner_id", runnerId).eq("data_source", "demo").abortSignal(signal).maybeSingle(), signal),
    stopOnAbort<{ data: Photo[] | null; error: unknown }>(bib === null ? Promise.resolve({ data: [], error: null }) : db.from("fotoyu_photos")
      .select("id,bib_number,photo_url,photographer,captured_km,captured_at").eq("bib_number", bib).order("captured_at", { ascending: true }).abortSignal(signal), signal),
    stopOnAbort(userId ? getRunnerStravaRoute(userId, runnerId, signal) : Promise.resolve(null), signal),
  ]);
  const warnings: string[] = [];
  const demoFailed = demo.status === "rejected" || !!demo.value.error;
  const photoFailed = photos.status === "rejected" || !!photos.value.error;
  // Organizer access to baseline results must never grant access to private athlete data.
  const ownerDenied = live.status === "rejected" && live.reason instanceof StravaError && live.reason.code === "runner_not_found";
  const liveFailed = live.status === "rejected" && !ownerDenied;
  const route = live.status === "fulfilled" ? live.value : null;
  let strava: WrappedPayloadStrava = { state: "disconnected", metrics: null };
  if (route && route.status !== "disconnected") {
    strava = {
      state: route.status === "matched" ? "connected" : ["reauth_required", "reauthorize_to_disconnect"].includes(route.status) ? "reauthorize_required" : route.status as WrappedPayloadStrava["state"],
      metrics: route.status === "matched" ? metrics(route.metrics) : null,
      activityId: route.activityId, candidates: route.candidates,
      reauthorizeToDisconnect: route.status === "reauthorize_to_disconnect",
    };
  } else if (!demoFailed && demo.value.data) {
    // The legacy table is sample data only; live provenance requires a current selection.
    strava = { state: "demo", metrics: metrics(demo.value.data) };
  }
  if (liveFailed || (demoFailed && (!route || route.status === "disconnected"))) strava = { state: "unavailable", metrics: null };
  // A failed authorization lookup is not proof of ownership. Apply this after
  // all fallback replacements so failures cannot restore mutation controls.
  if (!route || ownerDenied || !userId) strava.controlsAvailable = false;
  if (demoFailed || liveFailed || strava.state === "unavailable") warnings.push("Extra activity details are unavailable. Your chip recap is ready.");
  if (photoFailed) warnings.push("Photos are unavailable. Try again later.");
  return { strava, photos: (!photoFailed && photos.status === "fulfilled" ? photos.value.data ?? [] : []) as Photo[], warnings };
}
