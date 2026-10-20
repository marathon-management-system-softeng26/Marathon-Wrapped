import type { WrappedPayload } from "./wrappedPayload";
import { formatMmSs } from "./format";
export function shareModel(payload: WrappedPayload) {
  const stats = payload.status === "unavailable" ? null : payload.stats;
  const finished = payload.status === "finisher";
  return {
    name:
      stats?.name ??
      (payload.status === "unavailable" ? payload.runner.name : "Runner"),
    bib:
      stats?.bib_number ??
      (payload.status === "unavailable" ? payload.runner.bib_number : null),
    event: stats?.event ?? "Soekarno Run 2027",
    distance: stats ? `${stats.distance_km.toFixed(1)} km` : "—",
    distanceLabel: finished ? "Race distance" : "Category distance",
    result: finished
      ? "Finished"
      : payload.status === "dnf"
        ? "Did not finish"
        : payload.status === "dns"
          ? "Did not start"
          : "Result unavailable",
    time:
      finished && stats?.elapsed_seconds != null
        ? formatMmSs(stats.elapsed_seconds)
        : "—",
    pace:
      finished && stats?.avg_pace_sec_km != null
        ? `${formatMmSs(stats.avg_pace_sec_km)} /km`
        : "—",
    rank:
      finished && stats?.category_rank != null
        ? `Category rank ${stats.category_rank}`
        : "",
  };
}
