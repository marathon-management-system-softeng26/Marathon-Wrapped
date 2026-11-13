import type { StravaWrappedSnapshotV1 } from "@/lib/strava/projection";

export const runnerId = "11111111-1111-1111-1111-111111111111";
export const registration = {
  runner: { id: runnerId, name: "Aina Putri", bibNumber: "A1001" },
  event: { name: "Soekarno Run", date: "2027-08-17", category: "5K" },
};

export const snapshot: StravaWrappedSnapshotV1 = {
  version: 1,
  ...registration,
  distanceMeters: 5100,
  movingTimeSeconds: 1448,
  elapsedTimeSeconds: 1523,
  averagePaceSecondsPerKm: 284,
  averageSpeedMps: 3.52,
  maxSpeedMps: 4.2,
  splits: [
    { kilometer: 1, distanceMeters: 1000, movingSeconds: 290, elapsedSeconds: 295, averageSpeedMps: 3.45, paceSecondsPerKm: 290 },
    { kilometer: 2, distanceMeters: 1000, movingSeconds: 280, elapsedSeconds: 286, averageSpeedMps: 3.57, paceSecondsPerKm: 280 },
  ],
  fastestKilometer: { kilometer: 2, paceSecondsPerKm: 280 },
  slowestKilometer: { kilometer: 1, paceSecondsPerKm: 290 },
  paceTrend: { direction: "faster", earlyPaceSecondsPerKm: 290, latePaceSecondsPerKm: 280 },
  averageHeartrate: 147.37,
  maxHeartrate: 173.19,
  elevationGainMeters: 62.81,
  calories: 405.64,
  averageCadence: 82.12,
};

export const photo = {
  id: "photo-1", bib_number: "A1001", photo_url: "/photos/finish.jpg",
  photographer: "Race photographer", captured_km: 5, captured_at: null,
};

export const ready = { state: "ready" as const, registration, snapshot, photos: [photo] };
export const candidate = {
  activityId: "9385137612", startTimeLocal: "2027-08-17T06:00:00+07:00", distanceMeters: 5100,
  sportType: "Run", gpsAvailable: false, matchReason: "missing_start_location",
};
export const privateFields = {
  activityId: "9385137612", athleteId: "1385631729", coordinates: [-6.175392, 106.827153],
  category_rank: 114532, category_percentile: 19.38, overtakes: 78351, elapsed_seconds: 2736,
};
