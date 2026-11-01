import { describe, expect, it } from "vitest";
import { matchActivityToRace, validateRaceMatchConfig, type RaceMatchConfig } from "../lib/strava/matching";
import type { StravaActivity } from "../lib/strava/client";

const baseConfig = {
  startTimeFrom: "2027-08-17T00:00:00Z",
  startTimeTo: "2027-08-17T02:00:00Z",
  startLatitude: -6.2,
  startLongitude: 106.8,
  startRadiusMeters: 200,
  distanceMeters: 5000,
  allowedSportTypes: ["Run"],
} satisfies RaceMatchConfig;

const baseActivity = {
  id: "activity-1",
  athleteId: "athlete-1",
  sportType: "Run",
  startDate: "2027-08-17T01:00:00Z",
  distanceMeters: 5000,
  startLatLng: [-6.2, 106.8],
  polyline: null,
} satisfies StravaActivity;

function config(overrides: Record<string, unknown> = {}): RaceMatchConfig {
  return { ...baseConfig, ...overrides } as RaceMatchConfig;
}

function activity(overrides: Record<string, unknown> = {}): StravaActivity {
  return { ...baseActivity, ...overrides } as StravaActivity;
}

describe("validateRaceMatchConfig", () => {
  it.each([
    ["timestamp without offset", { startTimeFrom: "2027-08-17T00:00:00" }],
    ["invalid timestamp", { startTimeFrom: "not-a-date" }],
    ["impossible calendar date", { startTimeFrom: "2027-02-30T01:00:00Z" }],
    ["reversed time window", { startTimeFrom: "2027-08-17T03:00:00Z" }],
    ["non-finite latitude", { startLatitude: Number.NaN }],
    ["latitude outside range", { startLatitude: 90.01 }],
    ["non-finite longitude", { startLongitude: Number.POSITIVE_INFINITY }],
    ["longitude outside range", { startLongitude: 180.01 }],
    ["negative radius", { startRadiusMeters: -1 }],
    ["non-finite radius", { startRadiusMeters: Number.POSITIVE_INFINITY }],
    ["partial location coordinates", { startLongitude: null, startRadiusMeters: null }],
    ["missing radius with coordinates", { startRadiusMeters: null }],
    ["non-positive category distance", { distanceMeters: 0 }],
    ["non-finite category distance", { distanceMeters: Number.NaN }],
    ["empty allowed sports", { allowedSportTypes: [] }],
    ["sport other than Run", { allowedSportTypes: ["Ride"] }],
    ["additional allowed sport", { allowedSportTypes: ["Run", "Ride"] }],
  ])("rejects %s", (_name, overrides) => {
    expect(() => validateRaceMatchConfig(config(overrides))).toThrow();
  });

  it("accepts an unset location only when all location fields are null", () => {
    const unsetLocation = config({ startLatitude: null, startLongitude: null, startRadiusMeters: null });
    expect(validateRaceMatchConfig(unsetLocation)).toEqual(unsetLocation);
  });

  it("accepts a window whose endpoints are the same instant", () => {
    const instantWindow = config({ startTimeFrom: "2027-08-17T01:00:00Z", startTimeTo: "2027-08-17T01:00:00Z" });
    expect(validateRaceMatchConfig(instantWindow)).toEqual(instantWindow);
  });
});

describe("matchActivityToRace", () => {
  it.each([
    ["the exact window start", { startDate: baseConfig.startTimeFrom }, baseActivity.distanceMeters],
    ["the exact window end", { startDate: baseConfig.startTimeTo }, baseActivity.distanceMeters],
    ["the lower 500 m distance boundary", {}, baseConfig.distanceMeters - 500],
    ["the upper 500 m distance boundary", {}, baseConfig.distanceMeters + 500],
  ])("auto-matches %s", (_name, activityOverrides, distanceMeters) => {
    expect(matchActivityToRace(activity({ ...activityOverrides, distanceMeters }), baseConfig)).toEqual({
      status: "auto_match",
      reason: "race_checks_passed",
    });
  });

  it("matches an activity at the sole instant in an equal-endpoint window", () => {
    const instant = "2027-08-17T01:00:00Z";
    expect(matchActivityToRace(activity({ startDate: instant }), config({ startTimeFrom: instant, startTimeTo: instant }))).toEqual({
      status: "auto_match",
      reason: "race_checks_passed",
    });
  });

  it.each([
    ["before the start window", { startDate: "2027-08-16T23:59:59.999Z" }, "outside_start_window"],
    ["after the end window", { startDate: "2027-08-17T02:00:00.001Z" }, "outside_start_window"],
    ["more than 500 m short", { distanceMeters: 4499.99 }, "distance_mismatch"],
    ["more than 500 m long", { distanceMeters: 5500.01 }, "distance_mismatch"],
    ["a non-Run sport", { sportType: "Ride" }, "wrong_sport"],
    ["an invalid timestamp", { startDate: "invalid" }, "invalid_start_time"],
    ["a timestamp without UTC offset", { startDate: "2027-08-17T01:00:00" }, "invalid_start_time"],
    ["an impossible calendar date", { startDate: "2027-02-30T01:00:00Z" }, "invalid_start_time"],
    ["a non-finite activity distance", { distanceMeters: Number.NaN }, "invalid_distance"],
    ["a negative activity distance", { distanceMeters: -1 }, "invalid_distance"],
    ["invalid activity coordinates", { startLatLng: [91, 0] }, "invalid_start_location"],
  ])("returns no_match for %s", (_name, activityOverrides, reason) => {
    expect(matchActivityToRace(activity(activityOverrides), baseConfig)).toEqual({ status: "no_match", reason });
  });

  it.each([
    ["coordinates inside the configured radius", [-6.2005, 106.8], 200, "auto_match"],
    ["coordinates outside the configured radius", [-6.202, 106.8], 100, "no_match"],
  ])("uses Haversine distance for %s", (_name, coordinates, radius, status) => {
    const result = matchActivityToRace(
      activity({ startLatLng: coordinates }),
      config({ startRadiusMeters: radius }),
    );
    expect(result.status).toBe(status);
    expect(result.reason).toBe(status === "auto_match" ? "race_checks_passed" : "outside_start_area");
  });

  it.each([
    ["missing activity GPS", activity({ startLatLng: null }), baseConfig],
    ["missing configured location", baseActivity, config({ startLatitude: null, startLongitude: null, startRadiusMeters: null })],
  ])("requires confirmation for %s", (label, candidate, race) => {
    expect(matchActivityToRace(candidate, race)).toEqual({
      status: "needs_confirmation",
      reason: label === "missing activity GPS" ? "missing_start_location" : "missing_configured_location",
    });
  });
});
