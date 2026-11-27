import type { WrappedStats } from "./types";
import type { StravaWrappedSnapshotV1 } from "./strava/projection";

export type StravaMetrics = {
  avg_heartrate: number | null; max_heartrate: number | null;
  elevation_gain_m: number | null; calories: number | null; avg_cadence: number | null;
};
export type Photo = {
  id: string; source: "personal" | "organizer"; bib_number: string | null; photo_url: string;
  photographer: string | null; captured_km: number | null; captured_at: string | null;
};

export function toOrganizerPhoto({ id, bib_number, photo_url, photographer, captured_km, captured_at }: Omit<Photo, "source">): Photo {
  return { id, source: "organizer", bib_number, photo_url, photographer, captured_km, captured_at };
}

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

export type StravaFirstWrappedPayload = { registration: WrappedRegistration; photoWarning?: string } & (
  | { state: WrappedStatus }
  | { state: "needs_confirmation"; candidates: StravaCandidate[] }
  | { state: "ready"; snapshot: StravaWrappedSnapshotV1; photos: Photo[] }
);

export type OfficialWrappedPayload = {
  kind: "official";
  registration: WrappedRegistration;
  result: {
    runnerId: string;
    eventId: number;
    bib: string;
    name: string;
    distance: "5K" | "10K";
    status: "finished" | "dnf" | "dns" | "dq" | "unknown";
    finishTimeMs: number | null;
    netTimeMs: number | null;
    overallRank: number | null;
    division: string | null;
    divisionRank: number | null;
    gender: string | null;
    genderRank: number | null;
    checkpoints: Array<{
      sequence: number;
      label: string;
      distanceMeters: number | null;
      displayedTimeMs: number | null;
      reportedSplitMs: number | null;
      referenceLabel: string | null;
    }>;
    sourceUrl: string | null;
  };
  strava: StravaFirstWrappedPayload | { state: "unavailable" };
  photos: Photo[];
  photoWarning?: string;
};

export type RunnerWrappedPayload = OfficialWrappedPayload | StravaFirstWrappedPayload;
