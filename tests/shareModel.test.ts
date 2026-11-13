import { describe, expect, it } from "vitest";
import { shareModel } from "@/lib/shareModel";
import { privateFields, ready, registration, snapshot } from "./fixtures/stravaWrapped";

describe("share composition", () => {
  it("allowlists registration and formatted Strava distance, moving time, pace and splits", () => {
    const payload = { ...ready, ...privateFields };
    expect(shareModel(payload)).toStrictEqual({
      name: "Aina Putri",
      bib: "A1001",
      event: "Soekarno Run",
      year: "2027",
      distance: "5.1 km",
      time: "24:08",
      pace: "4:44 /km",
      splits: ["Km 1 · 4:50 /km", "Km 2 · 4:40 /km"],
      splitNote: null,
    });
  });

  it("uses absence copy for missing pace and kilometer splits", () => {
    const payload = { ...ready, snapshot: { ...snapshot, averagePaceSecondsPerKm: null, splits: [] } };
    expect(shareModel(payload)).toMatchObject({
      pace: "Average pace unavailable",
      splits: [],
      splitNote: "No kilometer splits available",
    });
  });

  it("reports unavailable pace for a recorded split without pace", () => {
    const payload = { ...ready, snapshot: { ...snapshot, splits: [{ ...snapshot.splits[0], paceSecondsPerKm: null }] } };
    expect(shareModel(payload)).toMatchObject({ splits: ["Km 1 · Pace unavailable"] });
  });

  it.each(["setup_required", "authorizing", "importing", "needs_confirmation", "no_match", "building", "failed", "reauth_required"] as const)(
    "rejects %s even when given stale ready data",
    (state) => {
      const payload = { ...ready, state, candidates: [] };
      expect(() => shareModel(payload)).toThrow("Your Wrapped is not ready to share.");
    },
  );

  it("rejects a ready response without a valid version 1 snapshot", () => {
    const payload = { state: "ready", registration, snapshot: { ...snapshot, version: 2 }, photos: [] };
    expect(() => shareModel(payload as unknown as typeof ready)).toThrow("Your Wrapped is not ready to share.");
  });
});
