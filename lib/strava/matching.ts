import type { StravaActivity } from "./client";

export type RaceMatchConfig = {
  startTimeFrom: string;
  startTimeTo: string;
  startLatitude: number | null;
  startLongitude: number | null;
  startRadiusMeters: number | null;
  distanceMeters: number;
  allowedSportTypes: string[];
};

export type ActivityMatchResult = {
  status: "auto_match" | "no_match" | "needs_confirmation";
  reason: string;
};

const DISTANCE_TOLERANCE_METERS = 500;
const EARTH_RADIUS_METERS = 6_371_000;
const OFFSET_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function utcInstant(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parts = value.match(OFFSET_TIMESTAMP);
  if (!parts) return null;

  const [year, month, day, hour, minute, second] = parts.slice(1, 7).map(Number);
  const calendarDate = new Date(0);
  calendarDate.setUTCFullYear(year, month - 1, day);
  calendarDate.setUTCHours(hour, minute, second, 0);
  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day ||
    calendarDate.getUTCHours() !== hour ||
    calendarDate.getUTCMinutes() !== minute ||
    calendarDate.getUTCSeconds() !== second
  ) {
    return null;
  }

  const instant = Date.parse(value);
  return Number.isFinite(instant) ? instant : null;
}

function validCoordinatePair(value: unknown): value is [number, number] {
  return Array.isArray(value) &&
    value.length === 2 &&
    value.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate)) &&
    Math.abs(value[0]) <= 90 &&
    Math.abs(value[1]) <= 180;
}

export function validateRaceMatchConfig(config: RaceMatchConfig): RaceMatchConfig {
  const value = config as unknown as Record<string, unknown>;
  const from = utcInstant(value.startTimeFrom);
  const to = utcInstant(value.startTimeTo);
  const locationValues = [value.startLatitude, value.startLongitude, value.startRadiusMeters];
  const locationIsUnset = locationValues.every((part) => part === null);
  const locationIsSet = locationValues.every((part) => typeof part === "number");

  if (
    from === null ||
    to === null ||
    from > to ||
    typeof value.distanceMeters !== "number" ||
    !Number.isFinite(value.distanceMeters) ||
    value.distanceMeters <= 0 ||
    !Array.isArray(value.allowedSportTypes) ||
    value.allowedSportTypes.length !== 1 ||
    value.allowedSportTypes[0] !== "Run" ||
    (!locationIsUnset && !locationIsSet)
  ) {
    throw new TypeError("invalid_race_match_config");
  }

  if (locationIsSet) {
    const latitude = value.startLatitude as number;
    const longitude = value.startLongitude as number;
    const radius = value.startRadiusMeters as number;

    if (
      !Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
      !Number.isFinite(longitude) || Math.abs(longitude) > 180 ||
      !Number.isFinite(radius) || radius < 0
    ) {
      throw new TypeError("invalid_race_match_config");
    }
  }

  return config;
}

function haversineMeters(first: [number, number], second: [number, number]): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const [latitude1, longitude1] = first.map(toRadians);
  const [latitude2, longitude2] = second.map(toRadians);
  const latitudeDelta = latitude2 - latitude1;
  const longitudeDelta = longitude2 - longitude1;
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(longitudeDelta / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function matchActivityToRace(
  activity: StravaActivity,
  race: RaceMatchConfig,
): ActivityMatchResult {
  const config = validateRaceMatchConfig(race);
  const start = utcInstant(activity.startDate);

  if (start === null) return { status: "no_match", reason: "invalid_start_time" };
  if (typeof activity.distanceMeters !== "number" || !Number.isFinite(activity.distanceMeters) || activity.distanceMeters < 0) {
    return { status: "no_match", reason: "invalid_distance" };
  }
  if (activity.startLatLng !== null && !validCoordinatePair(activity.startLatLng)) {
    return { status: "no_match", reason: "invalid_start_location" };
  }

  if (activity.sportType !== "Run" || !config.allowedSportTypes.includes(activity.sportType)) {
    return { status: "no_match", reason: "wrong_sport" };
  }

  const from = utcInstant(config.startTimeFrom)!;
  const to = utcInstant(config.startTimeTo)!;
  if (start < from || start > to) return { status: "no_match", reason: "outside_start_window" };
  if (Math.abs(activity.distanceMeters - config.distanceMeters) > DISTANCE_TOLERANCE_METERS) {
    return { status: "no_match", reason: "distance_mismatch" };
  }

  if (config.startLatitude === null) {
    return { status: "needs_confirmation", reason: "missing_configured_location" };
  }
  if (activity.startLatLng === null) {
    return { status: "needs_confirmation", reason: "missing_start_location" };
  }

  const configuredStart: [number, number] = [config.startLatitude, config.startLongitude!];
  if (haversineMeters(activity.startLatLng, configuredStart) > config.startRadiusMeters!) {
    return { status: "no_match", reason: "outside_start_area" };
  }

  return { status: "auto_match", reason: "race_checks_passed" };
}
