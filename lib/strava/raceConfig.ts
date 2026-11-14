/**
 * Organizer-managed race matching parameters for one category.
 *
 * Pure validation only: no I/O, no provider calls. Start coordinates are organizer-only
 * configuration and must never reach a runner-facing payload.
 */

export type StravaRaceConfig = {
  categoryId: number;
  startTimeFrom: string;
  startTimeTo: string;
  allowedSportTypes: ["Run"];
  distanceToleranceM: number;
  startLatitude: number | null;
  startLongitude: number | null;
  startRadiusM: number | null;
};

export class RaceConfigError extends Error {}

export const MAX_DISTANCE_TOLERANCE_M = 5000;

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** A timezone-bearing ISO instant. A bare local time is ambiguous for race matching. */
function instant(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new RaceConfigError(`Give ${field} as a date and time with a time zone, for example 2027-08-17T06:00:00+07:00.`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new RaceConfigError(`Give ${field} as a real date and time.`);
  return parsed.toISOString();
}

function tolerance(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0 || value > MAX_DISTANCE_TOLERANCE_M) {
    throw new RaceConfigError(`Give a distance tolerance between 1 and ${MAX_DISTANCE_TOLERANCE_M} metres.`);
  }
  return value;
}

function coordinate(value: unknown, field: string, limit: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < -limit || value > limit) {
    throw new RaceConfigError(`Give ${field} between -${limit} and ${limit}, or leave the start location empty.`);
  }
  return value;
}

/** Accepts only a complete, self-consistent category configuration. */
export function parseStravaRaceConfig(categoryId: number, input: unknown): StravaRaceConfig {
  if (!isObject(input)) throw new RaceConfigError("Send a race configuration object.");
  if (!Number.isSafeInteger(categoryId) || categoryId <= 0) throw new RaceConfigError("Choose a category for this configuration.");

  const sports = input.allowedSportTypes ?? ["Run"];
  if (!Array.isArray(sports) || sports.length !== 1 || sports[0] !== "Run") {
    throw new RaceConfigError("Only Run activities can be matched to a race.");
  }

  const startTimeFrom = instant(input.startTimeFrom, "the window start");
  const startTimeTo = instant(input.startTimeTo, "the window end");
  // The window is inclusive of its bounds, so it must span a real interval.
  if (Date.parse(startTimeFrom) >= Date.parse(startTimeTo)) {
    throw new RaceConfigError("The window end must come after the window start.");
  }

  const present = (["startLatitude", "startLongitude", "startRadiusM"] as const)
    .filter((key) => input[key] !== null && input[key] !== undefined);
  if (present.length !== 0 && present.length !== 3) {
    throw new RaceConfigError("Give the start latitude, longitude and radius together, or leave all three empty.");
  }
  const located = present.length === 3;
  const radius = located ? input.startRadiusM : null;
  if (located && (typeof radius !== "number" || !Number.isFinite(radius) || radius < 0)) {
    throw new RaceConfigError("Give a start radius of zero metres or more.");
  }

  return {
    categoryId,
    startTimeFrom,
    startTimeTo,
    allowedSportTypes: ["Run"],
    distanceToleranceM: tolerance(input.distanceToleranceM),
    startLatitude: located ? coordinate(input.startLatitude, "the start latitude", 90) : null,
    startLongitude: located ? coordinate(input.startLongitude, "the start longitude", 180) : null,
    startRadiusM: located ? (radius as number) : null,
  };
}

type ConfigRow = {
  category_id: number;
  start_time_from: string;
  start_time_to: string;
  allowed_sport_types: string[];
  distance_tolerance_m: number;
  start_latitude: number | null;
  start_longitude: number | null;
  start_radius_m: number | null;
};

export const toConfigRow = (config: StravaRaceConfig): ConfigRow => ({
  category_id: config.categoryId,
  start_time_from: config.startTimeFrom,
  start_time_to: config.startTimeTo,
  allowed_sport_types: config.allowedSportTypes,
  distance_tolerance_m: config.distanceToleranceM,
  start_latitude: config.startLatitude,
  start_longitude: config.startLongitude,
  start_radius_m: config.startRadiusM,
});

export const fromConfigRow = (row: ConfigRow): StravaRaceConfig => ({
  categoryId: row.category_id,
  startTimeFrom: row.start_time_from,
  startTimeTo: row.start_time_to,
  allowedSportTypes: ["Run"],
  distanceToleranceM: row.distance_tolerance_m,
  startLatitude: row.start_latitude,
  startLongitude: row.start_longitude,
  startRadiusM: row.start_radius_m,
});
