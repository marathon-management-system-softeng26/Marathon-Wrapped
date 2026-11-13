import type { StravaMetrics, WrappedPayloadStrava } from "../wrappedPayload";
import type { RunnerStravaRoute } from "./processing";

export type StravaActionId = "connect" | "attach" | "check" | "detach" | "disconnect" | "cancel";
type Action = { id: StravaActionId; label: string; method: "GET" | "POST" | "DELETE"; path: string; disabled: boolean };
const titles: Record<WrappedPayloadStrava["state"], string> = {
  disconnected: "Connect Strava", attachable: "Use Strava for this race", demo: "Sample activity metrics", authorizing: "Authorize Strava",
  importing: "Importing your activity", needs_confirmation: "Choose your race activity", no_match: "No race activity found",
  building: "Building your Wrapped", connected: "Your Strava activity", unavailable: "Activity details are unavailable",
  disconnecting: "Disconnecting Strava", reauthorize_required: "Authorize Strava again",
};
const descriptions: Record<WrappedPayloadStrava["state"], string> = {
  disconnected: "Add activity details from your Strava account. You choose whether to connect. Strava asks for access to your activities, including private ones, so a private race run can still be used.",
  attachable: "Your Strava account is connected. Use it for this race to find the activity you ran, including a private one. Other races stay unchanged.",
  demo: "Seeded sample metrics. These are not from a live Strava activity. Connect to use your own race activity.",
  authorizing: "Continue in Strava to allow access, or cancel the connection.",
  importing: "We are checking your saved activities for this race. You can keep exploring your recap.",
  needs_confirmation: "Check the date and distance, then confirm the activity you ran in this race.",
  no_match: "No saved activity matches this race yet. Check that the run is uploaded to Strava, then check status again.",
  building: "Building your Wrapped from the activity you selected. This page updates when it is ready.",
  connected: "These details come from your selected Strava activity. Missing measurements stay empty.",
  unavailable: "Your activity details could not load. Check status to try again.",
  disconnecting: "Activity imports are disabled. Strava is still removing access. Check status or retry disconnecting.",
  reauthorize_required: "Strava needs your permission again before activity details can be used.",
};
export function stravaViewModel(input: WrappedPayloadStrava, runnerId: string, pending = false) {
  const ids: Record<WrappedPayloadStrava["state"], StravaActionId[]> = {
    disconnected: ["connect"], attachable: ["attach", "disconnect"], demo: ["connect"], authorizing: ["cancel"],
    importing: ["check", "detach", "disconnect"], needs_confirmation: ["check", "detach", "disconnect"],
    no_match: ["connect", "check", "detach", "disconnect"], building: ["check", "detach", "disconnect"],
    connected: ["check", "detach", "disconnect"], unavailable: ["connect", "check", "detach", "disconnect"],
    disconnecting: ["check", "disconnect"], reauthorize_required: ["connect", "disconnect"],
  };
  const actions: Action[] = (input.controlsAvailable === false ? [] : ids[input.state]).map((id) => ({
    id, label: id === "connect" ? input.reauthorizeToDisconnect ? "Authorize to finish disconnecting" : input.state === "reauthorize_required" ? "Authorize Strava" : ["no_match", "unavailable"].includes(input.state) ? "Retry import" : "Connect Strava"
      : id === "attach" ? "Use Strava for this race"
      : id === "detach" ? "Remove Strava from this race"
      : id === "disconnect" ? input.state === "disconnecting" ? "Retry disconnecting" : "Disconnect Strava"
      : id === "cancel" ? "Cancel connection" : "Check status",
    method: id === "check" ? "GET" : id === "cancel" ? "DELETE" : "POST",
    // Attachment is per registration; connection and disconnection are account wide.
    path: ["check", "attach", "detach"].includes(id)
      ? `/api/runners/${encodeURIComponent(runnerId)}/strava${id === "check" ? "" : `/${id}`}`
      : `/api/strava/${id === "cancel" ? "connect" : id}`,
    disabled: pending,
  }));
  const labels: Record<keyof StravaMetrics, string> = {
    avg_heartrate: "Average heart rate (bpm)", max_heartrate: "Maximum heart rate (bpm)",
    elevation_gain_m: "Elevation gain (m)", calories: "Calories (kcal)",
    avg_cadence: input.state === "demo" ? "Average cadence (sample spm)" : "Average cadence (Strava value)",
  };
  const metrics = input.state === "connected" || input.state === "demo" ? (Object.keys(labels) as (keyof StravaMetrics)[]).flatMap((key) => {
    const value = input.metrics?.[key];
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? [{ label: labels[key], value }] : [];
  }) : [];
  const candidates = input.controlsAvailable !== false && input.state === "needs_confirmation" ? (input.candidates ?? []).flatMap((candidate) => {
    const date = new Date(candidate.startTimeLocal);
    if (!Number.isFinite(date.getTime()) || !Number.isFinite(candidate.distanceMeters) || candidate.distanceMeters < 0) return [];
    const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" }).format(date);
    const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Jakarta" }).format(date);
    return [{ activityId: candidate.activityId, label: `${day}, ${time} WIB · ${(candidate.distanceMeters / 1000).toFixed(2)} km`,
      note: candidate.gpsAvailable ? "Confirm this is your race activity." : "GPS is unavailable. Confirm this is your race activity." }];
  }) : [];
  return { title: titles[input.state], description: input.reauthorizeToDisconnect ? "Imports are disabled. Authorize Strava to finish removing access, then disconnect again." : descriptions[input.state],
    baselineCopy: "Your chip result, splits and photos remain available independently.", actions, metrics, candidates };
}

export function routeToStrava(route: Pick<RunnerStravaRoute, "status"> & Partial<Omit<RunnerStravaRoute, "status">>): WrappedPayloadStrava {
  const status = route.status;
  const state: WrappedPayloadStrava["state"] = status === "matched" ? "connected" : status === "reauth_required" || status === "reauthorize_to_disconnect" ? "reauthorize_required"
    : ["disconnected", "attachable", "disconnecting", "importing", "needs_confirmation", "no_match", "building", "unavailable"].includes(status) ? status as WrappedPayloadStrava["state"] : "unavailable";
  const source = route.metrics ?? {};
  const number = (key: keyof StravaMetrics) => typeof source[key] === "number" && Number.isFinite(source[key]) && source[key]! >= 0 ? source[key]! : null;
  return { state, activityId: status === "matched" ? route.activityId ?? null : null,
    candidates: status === "needs_confirmation" || status === "matched" ? route.candidates ?? [] : [],
    metrics: status === "matched" ? { avg_heartrate: number("avg_heartrate"), max_heartrate: number("max_heartrate"), elevation_gain_m: number("elevation_gain_m"), calories: number("calories"), avg_cadence: number("avg_cadence") } : null,
    reauthorizeToDisconnect: status === "reauthorize_to_disconnect" };
}

const callbackMessages = new Map<string, string>([
  ["connected", "Strava authorized. Checking your race activity."],
  ["already_connected", "Strava is already connected. Checking your race activity."],
  ["cancelled", "Strava connection cancelled."],
  ["in_progress", "Strava authorization is still processing. Check status in a moment."],
  ["disconnecting", "Strava is still disconnecting. Check status in a moment."],
  ["insufficient_scope", "Allow activity access in Strava to connect your race activity."],
  ["expired", "Strava authorization expired. Connect again to try again."],
  ["athlete_conflict", "This Strava account is already connected elsewhere. Choose another account."],
  ["different_runner", "Strava is connected to another recap. Disconnect it there before connecting this recap."],
  ["import_failed", "Strava connected, but activity import could not start. Retry import."],
]);

/** Allowlisted provider feedback: an unrecognized or absent code never reaches the reader verbatim. */
export function callbackNotice(code: string | null | undefined): string {
  return callbackMessages.get(code ?? "") ?? "Strava could not connect. Try connecting again.";
}

/** Pure URL transformation: the component applies it with history.replaceState after displaying feedback. */
export function callbackFeedback(href: string): { notice: string; path: string } | null {
  const url = new URL(href);
  if (!url.searchParams.has("strava")) return null;
  const notice = callbackNotice(url.searchParams.get("strava"));
  url.searchParams.delete("strava");
  return { notice, path: url.pathname + url.search + url.hash };
}

export async function runStravaAction(fetcher: typeof fetch, runnerId: string, action: Exclude<StravaActionId, "connect"> | "confirm", activityId?: string, signal?: AbortSignal): Promise<WrappedPayloadStrava> {
  const runnerPath = `/api/runners/${encodeURIComponent(runnerId)}/strava`;
  const path = action === "disconnect" ? "/api/strava/disconnect" : action === "cancel" ? "/api/strava/connect"
    : action === "attach" || action === "detach" ? `${runnerPath}/${action}` : runnerPath;
  const response = await fetcher(path, { method: action === "cancel" ? "DELETE" : action === "confirm" ? "PUT" : action === "check" ? "GET" : "POST",
    cache: "no-store", credentials: "same-origin", signal,
    ...(action === "confirm" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activityId }) } : {}) });
  const body = await response.json();
  if (action === "disconnect" && response.status === 409 && body.status === "reauthorize_to_disconnect") return routeToStrava(body);
  if (!response.ok) throw new Error(response.status === 401 ? "Sign in again to update Strava." : response.status === 409 ? "This activity has changed. Check status and choose again." : "Strava could not update. Check status to try again.");
  if (action === "cancel") return { state: "disconnected", metrics: null };
  return routeToStrava(body);
}
