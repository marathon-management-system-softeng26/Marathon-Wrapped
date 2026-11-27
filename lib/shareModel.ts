import { formatMmSs } from "./format";
import { buildRecapViewModel } from "./recapViewModel";
import { isStravaWrappedSnapshotV1 } from "./strava/projection";
import type { OfficialWrappedPayload, RunnerWrappedPayload } from "./wrappedPayload";

const outcomeTime = { dnf: "Did not finish", dns: "Did not start", dq: "Disqualified", unknown: "Official result" } as const;
const isOfficial = (payload: RunnerWrappedPayload): payload is OfficialWrappedPayload => "kind" in payload && payload.kind === "official";

export function shareModel(payload: RunnerWrappedPayload) {
  const official = isOfficial(payload);
  if (!official && (payload.state !== "ready" || !isStravaWrappedSnapshotV1(payload.snapshot) || payload.snapshot.runner.id !== payload.registration.runner.id)) throw new Error("Your Wrapped is not ready to share.");
  const model = buildRecapViewModel(payload);
  if (!model.exportable || !model.performance) throw new Error("Your Wrapped is not ready to share.");
  const { registration, performance } = model;
  const timingLabel = model.outcome === "finished" && performance.elapsedMs !== null
    ? model.source === "official" ? "official time" : "moving time"
    : null;
  const pace = performance.averagePaceSecondsPerKm === null ? (model.source === "official" && model.outcome !== "finished" ? "Pace unavailable" : "Average pace unavailable") : `${formatMmSs(performance.averagePaceSecondsPerKm)} /km`;
  const splits = !official && payload.state === "ready"
    ? payload.snapshot.splits.map((split) => `Km ${split.kilometer} · ${split.paceSecondsPerKm === null ? "Pace unavailable" : `${formatMmSs(split.paceSecondsPerKm)} /km`}`)
    : performance.splits.map((split) => split.splitMs === null ? `${split.label} · Split unavailable` : `${split.label} · ${formatMmSs(split.splitMs / 1000)} split`);
  return {
    name: registration.runner.name, bib: registration.runner.bibNumber, event: registration.event.name,
    year: registration.event.date.slice(0, 4), distance: `${(performance.distanceMeters / 1000).toFixed(1)} km`,
    time: model.outcome === "finished"
      ? (performance.elapsedMs === null ? "Official time unavailable" : formatMmSs(performance.elapsedMs / 1000))
      : outcomeTime[model.outcome],
    timingLabel, pace, splits, splitNote: splits.length ? null : "No kilometer splits available",
    source: model.source, outcome: model.outcome,
    attribution: model.source === "official" ? "Official race result" : "Powered by Strava",
  };
}
