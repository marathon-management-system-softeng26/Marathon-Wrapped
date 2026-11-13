import type { StravaCandidate } from "../wrappedPayload";

export type CandidateActivity = {
  id: string;
  athleteId: string;
  sportType: string;
  startDate?: unknown;
  distanceMeters?: unknown;
  gpsAvailable?: unknown;
};

export type CandidateRow = { activity_id: string; match_status: string; reason: string; summary: unknown };

function candidateDisplay(value: unknown) {
  if (value === null || typeof value !== "object") return null;
  const { startDate, distanceMeters, gpsAvailable } = value as Record<string, unknown>;
  if (typeof startDate !== "string" || !/(Z|[+-]\d{2}:\d{2})$/.test(startDate) ||
    typeof distanceMeters !== "number" || !Number.isFinite(distanceMeters) || distanceMeters < 0) return null;

  // Provider dates represent UTC instants. Candidates are shown in Jakarta time.
  const local = new Date(Date.parse(startDate) + 7 * 60 * 60 * 1000);
  if (!Number.isFinite(local.getTime())) return null;
  return {
    startTimeLocal: local.toISOString().slice(0, 19) + "+07:00",
    distanceMeters,
    gpsAvailable: typeof gpsAvailable === "boolean" ? gpsAvailable : null,
  };
}

export function safeCandidate(row: CandidateRow, activity: CandidateActivity, athleteId: string): StravaCandidate | null {
  if (activity.id !== row.activity_id || activity.athleteId !== athleteId || activity.sportType !== "Run" ||
    !/^[1-9]\d{0,18}$/.test(activity.id)) return null;
  const display = candidateDisplay(row.summary) ?? candidateDisplay(activity);
  if (!display) return null;

  const knownReasons = ["race_checks_passed", "missing_start_location", "missing_configured_location"];
  const gpsAvailable = display.gpsAvailable ?? (activity.gpsAvailable === true);
  return {
    activityId: activity.id, startTimeLocal: display.startTimeLocal, distanceMeters: display.distanceMeters,
    sportType: "Run", gpsAvailable: row.reason !== "missing_start_location" && gpsAvailable,
    matchReason: knownReasons.includes(row.reason) ? row.reason : "confirmation_required",
  };
}
