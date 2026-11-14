import { formatMmSs } from "./format";
import { isStravaWrappedSnapshotV1 } from "./strava/projection";
import type { StravaFirstWrappedPayload } from "./wrappedPayload";

export function shareModel(payload: StravaFirstWrappedPayload) {
  if (payload.state !== "ready" || !isStravaWrappedSnapshotV1(payload.snapshot) ||
      payload.snapshot.runner.id !== payload.registration.runner.id) {
    throw new Error("Your Wrapped is not ready to share.");
  }
  const { registration, snapshot } = payload;
  return {
    name: registration.runner.name,
    bib: registration.runner.bibNumber,
    event: registration.event.name,
    year: registration.event.date.slice(0, 4),
    distance: `${(snapshot.distanceMeters / 1000).toFixed(1)} km`,
    time: formatMmSs(snapshot.movingTimeSeconds),
    pace: snapshot.averagePaceSecondsPerKm === null
      ? "Average pace unavailable"
      : `${formatMmSs(snapshot.averagePaceSecondsPerKm)} /km`,
    splits: snapshot.splits.map(({ kilometer, paceSecondsPerKm }) =>
      `Km ${kilometer} · ${paceSecondsPerKm === null ? "Pace unavailable" : `${formatMmSs(paceSecondsPerKm)} /km`}`),
    splitNote: snapshot.splits.length ? null : "No kilometer splits available",
  };
}
