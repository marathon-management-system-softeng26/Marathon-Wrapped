import { describe, expect, it } from "vitest";
import { shareModel } from "@/lib/shareModel";
import { personalPhoto, privateFields, ready, registration, snapshot } from "./fixtures/stravaWrapped";
import type { OfficialWrappedPayload } from "@/lib/wrappedPayload";

const official: OfficialWrappedPayload = { kind: "official", registration, photos: [], strava: { state: "unavailable" }, result: {
  runnerId: registration.runner.id, eventId: 1, bib: "A1001", name: "Aina Putri", distance: "5K", status: "finished",
  finishTimeMs: 2_000_000, netTimeMs: 1_990_000, overallRank: 12, division: "F30", divisionRank: 4,
  gender: "F", genderRank: 9, checkpoints: [{ sequence: 1, label: "5K", distanceMeters: 5000, displayedTimeMs: 2_000_000, reportedSplitMs: 1_990_000, referenceLabel: "Finish" }], sourceUrl: null,
} };

describe("share composition", () => {
  it("composes an official-only finished result", () => {
    expect(shareModel(official)).toMatchObject({ source: "official", outcome: "finished", distance: "5.0 km", time: "33:10", pace: "6:38 /km", attribution: "Official race result" });
  });

  it("uses outcome copy and withholds finish metrics for a non-finisher", () => {
    expect(shareModel({ ...official, result: { ...official.result, status: "dnf" } })).toMatchObject({ outcome: "dnf", time: "Did not finish", pace: "Pace unavailable", splits: [] });
  });
  it("allowlists registration and formatted Strava distance, moving time, pace and splits", () => {
    const payload = { ...ready, ...privateFields, photos: [personalPhoto, ...ready.photos] };
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
      source: "strava",
      outcome: "finished",
      attribution: "Powered by Strava",
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
