import { describe, expect, it } from "vitest";
import type { StravaActivity } from "../lib/strava/client";
import { buildStravaWrappedProjection, type RunnerProjectionContext } from "../lib/strava/projection";

const activity = {
  id: "101",
  athleteId: "20",
  sportType: "Run",
  startDate: "2026-10-28T10:00:00.000Z",
  startLatLng: [-6.2, 106.8],
  distanceMeters: 4099.6,
  movingTimeSeconds: 1245,
  elapsedTimeSeconds: 1378,
  averageSpeedMps: 3.295,
  maxSpeedMps: 4.888,
  metricSplits: [
    { kilometer: 1, distanceMeters: 1000, movingSeconds: 340, elapsedSeconds: 400, averageSpeedMps: 2.94 },
    { kilometer: 2, distanceMeters: 1000, movingSeconds: 320, elapsedSeconds: 330, averageSpeedMps: 3.125 },
    { kilometer: 3, distanceMeters: 999.6, movingSeconds: 290, elapsedSeconds: 320, averageSpeedMps: 3.447 },
    { kilometer: 4, distanceMeters: 1000, movingSeconds: 280, elapsedSeconds: 300, averageSpeedMps: 3.571 },
    { kilometer: 5, distanceMeters: 100, movingSeconds: 15, elapsedSeconds: 28, averageSpeedMps: null },
  ],
  averageHeartrate: 151.5,
  maxHeartrate: 184,
  elevationGainMeters: 21.7,
  calories: 182.2,
  averageCadence: 86.4,
} satisfies StravaActivity;

const context = {
  runnerId: "runner-1",
  runnerName: "Dewi Runner",
  bibNumber: "0123",
  eventName: "Jakarta Race Day",
  eventDate: "2026-10-28",
  categoryName: "5K",
} satisfies RunnerProjectionContext;

describe("buildStravaWrappedProjection", () => {
  it("projects versioned registration context and selected Strava performance in documented units", () => {
    expect(buildStravaWrappedProjection(activity, context)).toEqual({
      version: 1,
      runner: { id: "runner-1", name: "Dewi Runner", bibNumber: "0123" },
      event: { name: "Jakarta Race Day", date: "2026-10-28", category: "5K" },
      distanceMeters: 4099.6,
      movingTimeSeconds: 1245,
      elapsedTimeSeconds: 1378,
      averagePaceSecondsPerKm: 304,
      averageSpeedMps: 3.295,
      maxSpeedMps: 4.888,
      splits: [
        { kilometer: 1, distanceMeters: 1000, movingSeconds: 340, elapsedSeconds: 400, averageSpeedMps: 2.94, paceSecondsPerKm: 340 },
        { kilometer: 2, distanceMeters: 1000, movingSeconds: 320, elapsedSeconds: 330, averageSpeedMps: 3.125, paceSecondsPerKm: 320 },
        { kilometer: 3, distanceMeters: 999.6, movingSeconds: 290, elapsedSeconds: 320, averageSpeedMps: 3.447, paceSecondsPerKm: 290 },
        { kilometer: 4, distanceMeters: 1000, movingSeconds: 280, elapsedSeconds: 300, averageSpeedMps: 3.571, paceSecondsPerKm: 280 },
        { kilometer: 5, distanceMeters: 100, movingSeconds: 15, elapsedSeconds: 28, averageSpeedMps: null, paceSecondsPerKm: 150 },
      ],
      fastestKilometer: { kilometer: 4, paceSecondsPerKm: 280 },
      slowestKilometer: { kilometer: 1, paceSecondsPerKm: 340 },
      paceTrend: { direction: "faster", earlyPaceSecondsPerKm: 330, latePaceSecondsPerKm: 285 },
      averageHeartrate: 151.5,
      maxHeartrate: 184,
      elevationGainMeters: 21.7,
      calories: 182.2,
      averageCadence: 86.4,
    });
  });

  it("preserves zero observations and leaves unavailable metrics and insights null", () => {
    const result = buildStravaWrappedProjection({
      ...activity,
      distanceMeters: 0,
      movingTimeSeconds: 0,
      elapsedTimeSeconds: 0,
      averageSpeedMps: null,
      maxSpeedMps: 0,
      metricSplits: null,
      averageHeartrate: null,
      maxHeartrate: null,
      elevationGainMeters: 0,
      calories: null,
      averageCadence: null,
    }, { ...context, bibNumber: null });

    expect(result).toMatchObject({
      runner: { bibNumber: null },
      distanceMeters: 0,
      movingTimeSeconds: 0,
      elapsedTimeSeconds: 0,
      averagePaceSecondsPerKm: null,
      averageSpeedMps: null,
      maxSpeedMps: 0,
      splits: [],
      fastestKilometer: null,
      slowestKilometer: null,
      paceTrend: null,
      averageHeartrate: null,
      maxHeartrate: null,
      elevationGainMeters: 0,
      calories: null,
      averageCadence: null,
    });
  });

  it("compares equally sized early and late groups and skips the middle kilometer", () => {
    const splits = [
      { kilometer: 1, distanceMeters: 1000, movingSeconds: 310, elapsedSeconds: 320, averageSpeedMps: null },
      { kilometer: 2, distanceMeters: 1000, movingSeconds: 160, elapsedSeconds: 170, averageSpeedMps: null },
      { kilometer: 3, distanceMeters: 1000, movingSeconds: 350, elapsedSeconds: 360, averageSpeedMps: null },
    ];

    expect(buildStravaWrappedProjection({ ...activity, metricSplits: splits }, context).paceTrend)
      .toEqual({ direction: "slower", earlyPaceSecondsPerKm: 310, latePaceSecondsPerKm: 350 });
  });

  it("uses distance-adjusted pace and resolves tied fastest kilometers by earliest kilometer", () => {
    const splits = [
      { kilometer: 1, distanceMeters: 990, movingSeconds: 297, elapsedSeconds: 300, averageSpeedMps: null },
      { kilometer: 2, distanceMeters: 1000, movingSeconds: 300, elapsedSeconds: 305, averageSpeedMps: null },
    ];
    const result = buildStravaWrappedProjection({ ...activity, metricSplits: splits }, context);

    expect(result.fastestKilometer).toEqual({ kilometer: 1, paceSecondsPerKm: 300 });
    expect(result.paceTrend).toEqual({ direction: "even", earlyPaceSecondsPerKm: 300, latePaceSecondsPerKm: 300 });
  });

  it.each([1010.1, 1500])("excludes a %s-meter split from kilometer insights", (distanceMeters) => {
    const metricSplits = [
      { kilometer: 1, distanceMeters: 1000, movingSeconds: 310, elapsedSeconds: 320, averageSpeedMps: null },
      { kilometer: 2, distanceMeters: 1010, movingSeconds: 303, elapsedSeconds: 310, averageSpeedMps: null },
      { kilometer: 3, distanceMeters, movingSeconds: 250, elapsedSeconds: 270, averageSpeedMps: null },
    ];
    const result = buildStravaWrappedProjection({ ...activity, metricSplits }, context);

    expect(result.splits).toHaveLength(3);
    expect(result.fastestKilometer).toEqual({ kilometer: 2, paceSecondsPerKm: 300 });
    expect(result.paceTrend).toEqual({ direction: "faster", earlyPaceSecondsPerKm: 310, latePaceSecondsPerKm: 300 });
  });

  it("omits trend for incomplete kilometer sequences and omits pace for zero moving time", () => {
    const splits = [activity.metricSplits[0], activity.metricSplits[2], {
      kilometer: 4, distanceMeters: 1000, movingSeconds: 0, elapsedSeconds: 150, averageSpeedMps: null,
    }];
    const result = buildStravaWrappedProjection({ ...activity, movingTimeSeconds: 0, metricSplits: splits }, context);

    expect(result.averagePaceSecondsPerKm).toBeNull();
    expect(result.splits[2].paceSecondsPerKm).toBeNull();
    expect(result.paceTrend).toBeNull();
  });

  it("rejects legacy activity detail without normalized timing", () => {
    const legacy = { ...activity };
    Reflect.deleteProperty(legacy, "movingTimeSeconds");
    Reflect.deleteProperty(legacy, "elapsedTimeSeconds");

    expect(() => buildStravaWrappedProjection(legacy, context)).toThrow("invalid_strava_activity");
  });

  it("omits routes, credentials, chip results and raw payload fields recursively", () => {
    const privateFields = {
      activityId: "101", athleteId: "20", rank: 1, percentile: 99, overtakes: 42, chipResult: {},
      route: [], map: {}, polyline: "private", coordinates: [], startLatLng: [-6.2, 106.8],
      endLatLng: [-6.2, 106.8], accessToken: "secret", refreshToken: "secret", rawPayload: {},
    };
    const input = {
      ...activity,
      ...privateFields,
      startLatLng: activity.startLatLng,
      metricSplits: activity.metricSplits.map((split) => ({ ...split, ...privateFields })),
    };
    const result = buildStravaWrappedProjection(input, { ...context, ...privateFields });
    const serialized = JSON.stringify(result);

    for (const key of Object.keys(privateFields)) {
      expect(serialized).not.toContain(`"${key}":`);
    }
  });
});
