import { describe, expect, it } from "vitest";
import { buildRecapViewModel } from "@/lib/recapViewModel";
import type { OfficialWrappedPayload } from "@/lib/wrappedPayload";
import { personalPhoto, photo, ready, registration, snapshot } from "@/tests/fixtures/stravaWrapped";

const officialResult: OfficialWrappedPayload["result"] = {
  runnerId: registration.runner.id,
  eventId: 7,
  bib: registration.runner.bibNumber!,
  name: registration.runner.name,
  distance: "5K",
  status: "finished",
  finishTimeMs: 2_005_213,
  netTimeMs: 1_999_000,
  overallRank: 12,
  division: "F30",
  divisionRank: 4,
  gender: "F",
  genderRank: 9,
  checkpoints: [
    {
      sequence: 1,
      label: "5K",
      distanceMeters: 5_000,
      displayedTimeMs: 2_005_213,
      reportedSplitMs: 1_999_000,
      referenceLabel: "Finish",
    },
  ],
  sourceUrl: "https://results.example.invalid/runner/1",
};

const official = (
  status: OfficialWrappedPayload["result"]["status"],
  strava: OfficialWrappedPayload["strava"] = { state: "unavailable" },
): OfficialWrappedPayload => ({
  kind: "official",
  registration,
  result: { ...officialResult, status },
  strava,
  photos: [photo],
});

describe("buildRecapViewModel", () => {
  it.each([
    ["dnf", "dnf"],
    ["dns", "dns"],
    ["dq", "dq"],
    ["unknown", "unknown"],
  ] as const)("keeps official %s outcomes non-finishing", (status, outcome) => {
    const model = buildRecapViewModel(official(status));

    expect(model.source).toBe("official");
    expect(model.outcome).toBe(outcome);
    expect(model.exportable).toBe(true);
    if (!model.performance) throw new Error("Official results must have a performance model.");
    expect(model.performance.elapsedMs).toBeNull();
    expect(model.performance.averagePaceSecondsPerKm).toBeNull();
    expect(model.performance.splits).toEqual([]);
  });

  it("uses official status, net time, distance, and splits over conflicting Strava metrics", () => {
    const model = buildRecapViewModel(official("finished", {
      ...ready,
      snapshot: {
        ...snapshot,
        distanceMeters: 10_000,
        movingTimeSeconds: 500,
        averagePaceSecondsPerKm: 50,
      },
    }));

    expect(model.source).toBe("official");
    expect(model.outcome).toBe("finished");
    expect(model.registration).toEqual(registration);
    expect(model.performance).toMatchObject({
      distanceMeters: 5_000,
      elapsedMs: 1_999_000,
      averagePaceSecondsPerKm: 399.8,
      splits: [{ label: "5K", distanceMeters: 5_000, elapsedMs: 2_005_213, splitMs: 1_999_000 }],
    });
    expect(model.strava.state).toBe("ready");
    expect(model.photos).toEqual([photo]);
    expect(model.exportable).toBe(true);
  });

  it("normalizes a ready Strava-only recap without inventing official placement", () => {
    const model = buildRecapViewModel({ ...ready, photos: [personalPhoto, photo] });

    expect(model).toMatchObject({
      source: "strava",
      outcome: "finished",
      registration,
      performance: {
        distanceMeters: 5_100,
        elapsedMs: 1_448_000,
        averagePaceSecondsPerKm: 284,
        overallRank: null,
      },
      strava: { state: "ready", snapshot },
      photos: [personalPhoto, photo],
      exportable: true,
    });
  });

  it("keeps an unfinished Strava workflow non-exportable", () => {
    const model = buildRecapViewModel({ state: "building", registration });

    expect(model.source).toBe("strava");
    expect(model.outcome).toBe("unknown");
    expect(model.performance).toBeNull();
    expect(model.photos).toEqual([]);
    expect(model.exportable).toBe(false);
  });
});
