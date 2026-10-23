import type { WrappedStats } from "./types";
import type { Enrichment, WrappedPayload } from "./wrappedPayload";

export function mergeWrapped(stats: WrappedStats, optional: Enrichment): WrappedPayload {
  return {
    status: stats.start_status === "dns" ? "dns" : stats.finisher ? "finisher" : "dnf",
    stats, strava: optional.strava,
    photos: optional.photos.filter(photo => stats.bib_number !== null && photo.bib_number === stats.bib_number),
    warnings: optional.warnings,
  };
}
