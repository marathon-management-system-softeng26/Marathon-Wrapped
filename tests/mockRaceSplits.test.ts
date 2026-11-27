import { describe, expect, it } from "vitest";
import { generateMockRaceSplits } from "@/lib/mockRaceSplits";

describe("generateMockRaceSplits", () => {
  it("creates one deterministic split per kilometer whose total matches the official time", () => {
    const first = generateMockRaceSplits(3_100_000, 5, "runner-1");
    const second = generateMockRaceSplits(3_100_000, 5, "runner-1");

    expect(first).toEqual(second);
    expect(first).toHaveLength(5);
    expect(first.map((split) => split.kilometer)).toEqual([1, 2, 3, 4, 5]);
    expect(first.every((split) => split.splitSeconds > 0)).toBe(true);
    expect(first.at(-1)?.elapsedSeconds).toBe(3_100);
    expect(first.reduce((total, split) => total + split.splitSeconds, 0)).toBe(3_100);
  });

  it("supports a ten kilometer race and keeps the final remainder exact", () => {
    const splits = generateMockRaceSplits(3_600_001, 10, "runner-2");

    expect(splits).toHaveLength(10);
    expect(splits.at(-1)?.elapsedSeconds).toBe(3_600.001);
    expect(splits.reduce((total, split) => total + split.splitSeconds, 0)).toBeCloseTo(3_600.001, 6);
  });
});
