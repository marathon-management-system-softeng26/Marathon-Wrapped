import type { StravaActivity } from "./client";

export type RaceMatchConfig = {
  startTimeFrom: string;
  startTimeTo: string;
  startLatitude: number;
  startLongitude: number;
  startRadiusMeters: number;
  distanceMeters: number;
  allowedSportTypes: string[];
};

export type ActivityMatchResult = {
  status: "match" | "no_match" | "needs_confirmation";
  reason: string;
};

/*
 * TODO pseudocode:
 * validate race configuration before matching:
 *     timestamps include an offset and startTimeFrom <= startTimeTo
 *     coordinates are valid and start radius is finite and nonnegative
 *     target distance is positive and allowedSportTypes is not empty
 * reject malformed activity timestamps/distances instead of guessing a match
 *
 * if activity.sportType is not in race.allowedSportTypes:
 *     return { status: "no_match", reason: "wrong_sport" }
 * parse activity.startDate and race window into comparable UTC instants
 * if activity start is outside the inclusive race start window:
 *     return { status: "no_match", reason: "outside_start_window" }
 * use the fixed distance tolerance defined in code, not organizer configuration
 * if abs(activity.distanceMeters - race.distanceMeters) exceeds tolerance:
 *     return { status: "no_match", reason: "distance_mismatch" }
 * if start coordinates are missing:
 *     return { status: "needs_confirmation", reason: "missing_start_location" }
 * validate the activity coordinates, then calculate Haversine distance in meters
 * if distance from the configured start exceeds race.startRadiusMeters:
 *     return { status: "no_match", reason: "outside_start_area" }
 * return { status: "match", reason: "race_checks_passed" }
 *
 * Keep this pure: no database calls, provider requests, or writes. Use category
 * distance, not a hard-coded marathon distance, and activity start, not upload
 * time. A match here is only a candidate; the processor resolves ambiguity
 * across activities/registrations before attaching anything automatically.
 */
export function matchActivityToRace(
  activity: StravaActivity,
  race: RaceMatchConfig,
): ActivityMatchResult | undefined {
  const tolerance = 500; // value need to be tested

  const distanceDiff = Math.abs(activity.distanceMeters - race.distanceMeters);

  if (activity.startLatLng === null) {
    return { status: "needs_confirmation", reason: "missing_start_location" };
  }

  const dateMatch = new Date(activity.startDate) >= new Date(race.startTimeFrom) && new Date(activity.startDate) <= new Date(race.startTimeTo);
  const distanceMatch = distanceDiff <= tolerance;
  const sportTypeMatch = race.allowedSportTypes.includes(activity.sportType);

  if (!dateMatch) {
    return { status: "no_match", reason: "outside_start_window" };
  }

  if (!distanceMatch) {
    return { status: "no_match", reason: "distance_mismatch" };
  }

  if (!sportTypeMatch) {
    return { status: "no_match", reason: "wrong_sport" };
  }


  return { status: "match", reason: "race_checks_passed" };

}
