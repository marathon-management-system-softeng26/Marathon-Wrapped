import { describe, expect, it } from "vitest";
import { buildInsights } from "@/lib/insights";
import { analyzeSplits } from "@/lib/stats";
import {
  ainaInput,
  ainaSplits,
  citraDnfInput,
  dewaDnsInput,
} from "./fixtures/runners";

describe("buildInsights", () => {
  it("emits finish, rank, percentile, fastest km, and negative split for Aina", () => {
    const aina = ainaInput();
    expect(buildInsights(aina, analyzeSplits(ainaSplits, 5))).toEqual([
      "Finish time 25:23",
      "Category rank 1",
      "Faster than 100% of your category",
      "Fastest kilometre: km 5 in 4:50",
      "Negative split — second half faster than the first",
    ]);
  });

  it("uses the DNF line and never a finish time (SR-NF5)", () => {
    const citra = citraDnfInput();
    const insights = buildInsights(citra, analyzeSplits(citra.splits, 5));
    expect(insights[0]).toBe("Did not finish — no official finish time");
    expect(insights.join(" ")).not.toMatch(/Finish time/);
  });

  it("uses the DNS line", () => {
    const dewa = dewaDnsInput();
    expect(buildInsights(dewa, analyzeSplits(dewa.splits, 10))).toEqual([
      "Did not start",
    ]);
  });
});
