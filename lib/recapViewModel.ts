import type {
  OfficialWrappedPayload,
  Photo,
  RunnerWrappedPayload,
  StravaFirstWrappedPayload,
  WrappedRegistration,
} from "./wrappedPayload";

export type RecapOutcome = OfficialWrappedPayload["result"]["status"];

export type RecapPerformance = {
  distanceMeters: number;
  elapsedMs: number | null;
  averagePaceSecondsPerKm: number | null;
  overallRank: number | null;
  division: string | null;
  divisionRank: number | null;
  gender: string | null;
  genderRank: number | null;
  splits: Array<{
    label: string;
    distanceMeters: number | null;
    elapsedMs: number | null;
    splitMs: number | null;
  }>;
};

export type RecapViewModel = {
  source: "official" | "strava";
  outcome: RecapOutcome;
  registration: WrappedRegistration;
  performance: RecapPerformance | null;
  strava: StravaFirstWrappedPayload | { state: "unavailable" };
  photos: Photo[];
  exportable: boolean;
};

function officialPerformance(payload: OfficialWrappedPayload): RecapPerformance {
  const { result } = payload;
  const finished = result.status === "finished";
  const elapsedMs = finished ? result.netTimeMs ?? result.finishTimeMs : null;
  const distanceMeters = Number(result.distance.slice(0, -1)) * 1_000;
  return {
    distanceMeters,
    elapsedMs,
    averagePaceSecondsPerKm:
      elapsedMs === null ? null : elapsedMs / 1_000 / (distanceMeters / 1_000),
    overallRank: finished ? result.overallRank : null,
    division: result.division,
    divisionRank: finished ? result.divisionRank : null,
    gender: result.gender,
    genderRank: finished ? result.genderRank : null,
    splits: finished
      ? result.checkpoints.map((checkpoint) => ({
          label: checkpoint.label,
          distanceMeters: checkpoint.distanceMeters,
          elapsedMs: checkpoint.displayedTimeMs,
          splitMs: checkpoint.reportedSplitMs,
        }))
      : [],
  };
}

function isOfficial(payload: RunnerWrappedPayload): payload is OfficialWrappedPayload {
  return "kind" in payload && payload.kind === "official";
}

export function buildRecapViewModel(payload: RunnerWrappedPayload): RecapViewModel {
  if (isOfficial(payload)) {
    return {
      source: "official",
      outcome: payload.result.status,
      registration: payload.registration,
      performance: officialPerformance(payload),
      strava: payload.strava,
      photos: payload.photos,
      exportable: true,
    };
  }

  if (payload.state !== "ready") {
    return {
      source: "strava",
      outcome: "unknown",
      registration: payload.registration,
      performance: null,
      strava: payload,
      photos: [],
      exportable: false,
    };
  }

  return {
    source: "strava",
    outcome: "finished",
    registration: payload.registration,
    performance: {
      distanceMeters: payload.snapshot.distanceMeters,
      elapsedMs: payload.snapshot.movingTimeSeconds * 1_000,
      averagePaceSecondsPerKm: payload.snapshot.averagePaceSecondsPerKm,
      overallRank: null,
      division: null,
      divisionRank: null,
      gender: null,
      genderRank: null,
      splits: payload.snapshot.splits.map((split) => ({
        label: `Km ${split.kilometer}`,
        distanceMeters: split.distanceMeters,
        elapsedMs: split.elapsedSeconds * 1_000,
        splitMs: split.movingSeconds * 1_000,
      })),
    },
    strava: payload,
    photos: payload.photos,
    exportable: true,
  };
}
