import { describe, expect, it } from "vitest";
import { ainaSplits, budiSplits, evenSplits } from "./fixtures/runners";
import {
  analyzeSplits,
  categoryPercentile,
  computeAvgPaceSecKm,
  computeElapsedSeconds,
  rankAmong,
} from "@/lib/stats";

describe("computeElapsedSeconds", () => {
  it("returns finish minus start in whole seconds (SR-F2)", () => {
    const start = new Date("2027-08-17T06:00:00.000Z");
    const finish = new Date("2027-08-17T06:25:23.000Z");
    expect(computeElapsedSeconds(start, finish)).toBe(1523);
  });
});

describe("computeAvgPaceSecKm", () => {
  it("divides elapsed seconds by category distance (SR-F3)", () => {
    expect(computeAvgPaceSecKm(1523, 5)).toBe(304.6);
    expect(computeAvgPaceSecKm(3600, 10)).toBe(360);
  });
});

describe("rankAmong", () => {
  it("ranks lower elapsed ahead and shares the min rank on ties (SR-F5)", () => {
    const field = [2100, 1800, 1523, 1523];
    expect(rankAmong(1523, field)).toBe(1);
    expect(rankAmong(1800, field)).toBe(3);
    expect(rankAmong(2100, field)).toBe(4);
  });
});

describe("categoryPercentile", () => {
  it("matches runner_wrapped percent_rank ordered by elapsed DESC", () => {
    const peers = [2100, 1800, 1523];
    expect(categoryPercentile(2100, peers)).toBe(0);
    expect(categoryPercentile(1800, peers)).toBe(0.5);
    expect(categoryPercentile(1523, peers)).toBe(1);
  });

  it("returns 0 for a single finisher", () => {
    expect(categoryPercentile(1523, [1523])).toBe(0);
  });
});

describe("analyzeSplits", () => {
  it("finds fastest km, negative split, and where Aina slowed", () => {
    expect(analyzeSplits(ainaSplits, 5)).toEqual({
      fastest_km: { km_marker: 5, split_seconds: 290 },
      split_type: "negative",
      first_half_seconds: 617,
      second_half_seconds: 588,
      slowed_after_km: 2,
    });
  });

  it("detects a positive 10K split", () => {
    expect(analyzeSplits(budiSplits, 10)).toEqual({
      fastest_km: { km_marker: 5, split_seconds: 332 },
      split_type: "positive",
      first_half_seconds: 1680,
      second_half_seconds: 1800,
      slowed_after_km: 5,
    });
  });

  it("treats halves within 1s/km as even and breaks fastest-km ties low", () => {
    expect(analyzeSplits(evenSplits, 5)).toEqual({
      fastest_km: { km_marker: 5, split_seconds: 299 },
      split_type: "even",
      first_half_seconds: 600,
      second_half_seconds: 600,
      slowed_after_km: 3,
    });
  });
});
