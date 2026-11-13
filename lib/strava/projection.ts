import type { StravaActivity, StravaSplit } from "./client";

export type RunnerProjectionContext = {
  runnerId: string;
  runnerName: string;
  bibNumber: string | null;
  eventName: string;
  eventDate: string;
  categoryName: string;
};

type WrappedSplit = StravaSplit & { paceSecondsPerKm: number | null };
type KilometerPace = { kilometer: number; paceSecondsPerKm: number };
type PaceTrend = {
  direction: "faster" | "slower" | "even";
  earlyPaceSecondsPerKm: number;
  latePaceSecondsPerKm: number;
};

export type StravaWrappedSnapshotV1 = {
  version: 1;
  runner: { id: string; name: string; bibNumber: string | null };
  event: { name: string; date: string; category: string };
  distanceMeters: number;
  movingTimeSeconds: number;
  elapsedTimeSeconds: number;
  averagePaceSecondsPerKm: number | null;
  averageSpeedMps: number | null;
  maxSpeedMps: number | null;
  splits: WrappedSplit[];
  fastestKilometer: KilometerPace | null;
  slowestKilometer: KilometerPace | null;
  paceTrend: PaceTrend | null;
  averageHeartrate: number | null;
  maxHeartrate: number | null;
  elevationGainMeters: number | null;
  calories: number | null;
  averageCadence: number | null;
};

export function isStravaWrappedSnapshotV1(value: unknown): value is StravaWrappedSnapshotV1 {
  const object = (v: unknown, keys: string[]): v is Record<string, unknown> =>
    v !== null && typeof v === "object" && !Array.isArray(v) &&
    Object.keys(v).length === keys.length && keys.every((key) => Object.hasOwn(v, key));
  const number = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= Number.MAX_SAFE_INTEGER;
  const integer = (v: unknown) => number(v) && Number.isSafeInteger(v);
  const nullable = (v: unknown, check: (value: unknown) => boolean) => v === null || check(v);
  const string = (v: unknown) => typeof v === "string";
  const keys = ["version", "runner", "event", "distanceMeters", "movingTimeSeconds", "elapsedTimeSeconds",
    "averagePaceSecondsPerKm", "averageSpeedMps", "maxSpeedMps", "splits", "fastestKilometer", "slowestKilometer",
    "paceTrend", "averageHeartrate", "maxHeartrate", "elevationGainMeters", "calories", "averageCadence"];
  if (!object(value, keys) || value.version !== 1 ||
    !object(value.runner, ["id", "name", "bibNumber"]) || !string(value.runner.id) || !string(value.runner.name) ||
    !nullable(value.runner.bibNumber, string) || !object(value.event, ["name", "date", "category"]) ||
    ![value.event.name, value.event.date, value.event.category].every(string) ||
    !number(value.distanceMeters) || !integer(value.movingTimeSeconds) || !integer(value.elapsedTimeSeconds) ||
    !nullable(value.averagePaceSecondsPerKm, integer) ||
    ![value.averageSpeedMps, value.maxSpeedMps, value.averageHeartrate, value.maxHeartrate,
      value.elevationGainMeters, value.calories, value.averageCadence].every((v) => nullable(v, number))) return false;
  const kilometerPace = (v: unknown) => object(v, ["kilometer", "paceSecondsPerKm"]) &&
    integer(v.kilometer) && (v.kilometer as number) > 0 && integer(v.paceSecondsPerKm);
  const trend = (v: unknown) => object(v, ["direction", "earlyPaceSecondsPerKm", "latePaceSecondsPerKm"]) &&
    ["faster", "slower", "even"].includes(v.direction as string) && integer(v.earlyPaceSecondsPerKm) && integer(v.latePaceSecondsPerKm);
  return nullable(value.fastestKilometer, kilometerPace) && nullable(value.slowestKilometer, kilometerPace) &&
    nullable(value.paceTrend, trend) && Array.isArray(value.splits) && value.splits.every((v: unknown) =>
      object(v, ["kilometer", "distanceMeters", "movingSeconds", "elapsedSeconds", "averageSpeedMps", "paceSecondsPerKm"]) &&
      integer(v.kilometer) && (v.kilometer as number) > 0 && number(v.distanceMeters) &&
      integer(v.movingSeconds) && integer(v.elapsedSeconds) && nullable(v.averageSpeedMps, number) && nullable(v.paceSecondsPerKm, integer));
}

// Allow one percent of measurement variation around a full kilometer.
const MIN_FULL_KILOMETER_METERS = 990;
const MAX_FULL_KILOMETER_METERS = 1010;

function pace(seconds: number, meters: number): number | null {
  if (seconds <= 0 || meters <= 0) return null;

  const secondsPerKm = (seconds * 1000) / meters;
  return Number.isFinite(secondsPerKm) ? secondsPerKm : null;
}

function displayPace(seconds: number, meters: number): number | null {
  const secondsPerKm = pace(seconds, meters);
  return secondsPerKm === null ? null : Math.round(secondsPerKm);
}

function groupPace(splits: WrappedSplit[]): number | null {
  let distance = 0;
  let seconds = 0;
  for (const split of splits) {
    distance += split.distanceMeters;
    seconds += split.movingSeconds;
  }
  return pace(seconds, distance);
}

function buildPaceTrend(kilometers: WrappedSplit[]): PaceTrend | null {
  const half = Math.floor(kilometers.length / 2);
  if (
    half === 0 ||
    !kilometers.every((split, index) => split.kilometer === index + 1 && split.paceSecondsPerKm !== null)
  ) {
    return null;
  }

  const early = groupPace(kilometers.slice(0, half));
  const late = groupPace(kilometers.slice(-half));
  if (early === null || late === null) return null;

  return {
    direction: Math.abs(early - late) <= 1 ? "even" : late < early ? "faster" : "slower",
    earlyPaceSecondsPerKm: Math.round(early),
    latePaceSecondsPerKm: Math.round(late),
  };
}

export function buildStravaWrappedProjection(
  activity: Omit<StravaActivity, "startLatLng">,
  context: RunnerProjectionContext,
): StravaWrappedSnapshotV1 {
  // Activity detail cached before timing normalization needs to be fetched again.
  if (!Number.isSafeInteger(activity.movingTimeSeconds) || !Number.isSafeInteger(activity.elapsedTimeSeconds)) {
    throw new TypeError("invalid_strava_activity");
  }

  const splits = (activity.metricSplits ?? []).map((split): WrappedSplit => ({
    kilometer: split.kilometer,
    distanceMeters: split.distanceMeters,
    movingSeconds: split.movingSeconds,
    elapsedSeconds: split.elapsedSeconds,
    averageSpeedMps: split.averageSpeedMps,
    paceSecondsPerKm: displayPace(split.movingSeconds, split.distanceMeters),
  }));
  const kilometers = splits.filter((split) =>
    split.distanceMeters >= MIN_FULL_KILOMETER_METERS && split.distanceMeters <= MAX_FULL_KILOMETER_METERS);
  let fastestKilometer: KilometerPace | null = null;
  let slowestKilometer: KilometerPace | null = null;
  let fastestPace = Infinity;
  let slowestPace = 0;
  for (const split of kilometers) {
    const secondsPerKm = pace(split.movingSeconds, split.distanceMeters);
    if (secondsPerKm === null) continue;

    const kilometerPace = { kilometer: split.kilometer, paceSecondsPerKm: Math.round(secondsPerKm) };
    if (secondsPerKm < fastestPace) {
      fastestPace = secondsPerKm;
      fastestKilometer = kilometerPace;
    }
    if (secondsPerKm > slowestPace) {
      slowestPace = secondsPerKm;
      slowestKilometer = kilometerPace;
    }
  }

  return {
    version: 1,
    runner: { id: context.runnerId, name: context.runnerName, bibNumber: context.bibNumber },
    event: { name: context.eventName, date: context.eventDate, category: context.categoryName },
    distanceMeters: activity.distanceMeters,
    movingTimeSeconds: activity.movingTimeSeconds,
    elapsedTimeSeconds: activity.elapsedTimeSeconds,
    averagePaceSecondsPerKm: displayPace(activity.movingTimeSeconds, activity.distanceMeters),
    averageSpeedMps: activity.averageSpeedMps,
    maxSpeedMps: activity.maxSpeedMps,
    splits,
    fastestKilometer,
    slowestKilometer,
    paceTrend: buildPaceTrend(kilometers),
    averageHeartrate: activity.averageHeartrate,
    maxHeartrate: activity.maxHeartrate,
    elevationGainMeters: activity.elevationGainMeters,
    calories: activity.calories,
    averageCadence: activity.averageCadence,
  };
}
