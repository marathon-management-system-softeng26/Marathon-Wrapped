import { describe, expect, it } from "vitest";
import { formatRankings } from "@/lib/rankings";
import type { RecapPerformance } from "@/lib/recapViewModel";

const base: RecapPerformance = {
  distanceMeters: 10_000, elapsedMs: 3_000_000, averagePaceSecondsPerKm: 300,
  overallRank: 412, division: "M30-39", divisionRank: 38, gender: "M", genderRank: 301, splits: [],
};

describe("formatRankings", () => {
  it("formats overall, division and gender placements", () => {
    expect(formatRankings(base)).toEqual(["#412 overall", "#38 in M30-39", "#301 men"]);
  });
  it("maps female gender labels", () => {
    expect(formatRankings({ ...base, gender: "Female" })).toContain("#301 women");
  });
  it("omits placements the official result does not supply", () => {
    expect(formatRankings({ ...base, divisionRank: null, genderRank: null })).toEqual(["#412 overall"]);
    expect(formatRankings({ ...base, overallRank: null, divisionRank: null, genderRank: null })).toEqual([]);
  });
});
