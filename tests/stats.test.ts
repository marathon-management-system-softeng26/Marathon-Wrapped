import { describe, expect, it } from "vitest";
import { computeAvgPaceSecKm, computeElapsedSeconds } from "@/lib/stats";

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
