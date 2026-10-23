import type { WrappedStats } from "./types";

export type StravaMetrics = {
  avg_heartrate: number | null; max_heartrate: number | null;
  elevation_gain_m: number | null; calories: number | null; avg_cadence: number | null;
};
export type Photo = {
  id: string; bib_number: string; photo_url: string;
  photographer: string | null; captured_km: number | null; captured_at: string | null;
};
export type WrappedPayloadStrava = {
  state: "disconnected" | "connected" | "unavailable" | "demo";
  metrics: StravaMetrics | null;
};
export type Enrichment = { strava: WrappedPayloadStrava; photos: Photo[]; warnings: string[] };
export type WrappedPayload =
  | { status: "finisher" | "dnf" | "dns"; stats: WrappedStats } & Enrichment
  | { status: "unavailable"; runner: { runner_id: string; name: string; bib_number: string | null }; reason: "missing_result" };
