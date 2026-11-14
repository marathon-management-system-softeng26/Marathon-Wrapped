import type { WrappedStats } from "./types";
import type { StravaWrappedSnapshotV1 } from "./strava/projection";

export type StravaMetrics = {
  avg_heartrate: number | null; max_heartrate: number | null;
  elevation_gain_m: number | null; calories: number | null; avg_cadence: number | null;
};
export type Photo = {
  id: string; bib_number: string; photo_url: string;
  photographer: string | null; captured_km: number | null; captured_at: string | null;
};
export type WrappedPayloadStrava = {
  state: "disconnected" | "attachable" | "authorizing" | "importing" | "needs_confirmation" | "no_match" | "building" | "connected" | "unavailable" | "disconnecting" | "reauthorize_required" | "demo";
  metrics: StravaMetrics | null;
  activityId?: string | null;
  candidates?: StravaCandidate[];
  reauthorizeToDisconnect?: boolean;
  controlsAvailable?: boolean;
};
export type StravaCandidate = {
  activityId: string; startTimeLocal: string; distanceMeters: number;
  sportType: string; gpsAvailable: boolean; matchReason: string;
};
export type Enrichment = { strava: WrappedPayloadStrava; photos: Photo[]; warnings: string[] };
export type WrappedPayload =
  | { status: "finisher" | "dnf" | "dns"; stats: WrappedStats } & Enrichment
  | ({ status: "unavailable"; runner: { runner_id: string; name: string; bib_number: string | null }; reason: "missing_result" } & Enrichment);

export type WrappedRegistration = Pick<StravaWrappedSnapshotV1, "runner" | "event">;

type WrappedStatus = "setup_required" | "authorizing" | "importing" | "no_match" | "building" | "failed" | "reauth_required";

export type StravaFirstWrappedPayload = { registration: WrappedRegistration } & (
  | { state: WrappedStatus }
  | { state: "needs_confirmation"; candidates: StravaCandidate[] }
  | { state: "ready"; snapshot: StravaWrappedSnapshotV1; photos: Photo[] }
);
