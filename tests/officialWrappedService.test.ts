import { describe, expect, it } from "vitest";
import { composeOfficialWrapped, type OfficialRecap } from "@/lib/officialWrappedService";

const result: OfficialRecap = {
  runnerId: "00000000-0000-4000-8000-000000000001",
  eventId: 7,
  bib: "00123",
  name: "Runner One",
  distance: "5K",
  status: "finished",
  finishTimeMs: 2005213,
  netTimeMs: 1999000,
  overallRank: 12,
  division: "M30",
  divisionRank: 4,
  gender: "M",
  genderRank: 9,
  checkpoints: [{ sequence: 1, label: "5K", distanceMeters: 5000, displayedTimeMs: 2005213, reportedSplitMs: 2005213, referenceLabel: "Finish" }],
  sourceUrl: "https://example.invalid/result/1",
};

describe("composeOfficialWrapped", () => {
  it("keeps official timing and provenance independent of Strava", () => {
    const payload = composeOfficialWrapped(result, { state: "unavailable" }, []);
    expect(payload.kind).toBe("official");
    expect(payload.result.finishTimeMs).toBe(2005213);
    expect(payload.result.checkpoints[0].reportedSplitMs).toBe(2005213);
    expect(payload.strava).toEqual({ state: "unavailable" });
  });

  it("does not invent timing for non-finishers", () => {
    const payload = composeOfficialWrapped({ ...result, status: "dnf", finishTimeMs: null, netTimeMs: null, overallRank: null }, { state: "unavailable" }, []);
    expect(payload.result.finishTimeMs).toBeNull();
    expect(payload.result.overallRank).toBeNull();
  });
});
