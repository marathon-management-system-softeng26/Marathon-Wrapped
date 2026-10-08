import { describe, expect, it } from "vitest";
import { buildInsights } from "@/lib/insights";
import { analyzeSplits } from "@/lib/stats";
import type { RunnerChipInput } from "@/lib/types";
import {
  ainaInput,
  ainaSplits,
  budiSplits,
  citraDnfInput,
  dewaDnsInput,
  evenSplits,
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

  it("emits positive split insight for Budi 10K", () => {
    const budi: RunnerChipInput = {
      runner_id: "44444444-4444-4444-4444-444444444444",
      bib_number: "B2001",
      name: "Budi Santoso",
      gender: "M",
      age: 35,
      event: "Soekarno Run 2027",
      category: "10K",
      distance_km: 10,
      start_status: "on-time",
      elapsed_seconds: 3480,
      avg_pace_sec_km: 348,
      category_rank: 12,
      overall_rank: 45,
      category_percentile: 0.75,
      finisher: true,
      splits: budiSplits,
    };
    const insights = buildInsights(budi, analyzeSplits(budiSplits, 10));
    expect(insights).toContain(
      "Positive split — second half slower than the first",
    );
  });

  it("emits even split insight for even halves", () => {
    const evenRunner: RunnerChipInput = {
      ...ainaInput(),
      elapsed_seconds: 1200,
      avg_pace_sec_km: 240,
      splits: evenSplits,
    };
    const insights = buildInsights(
      evenRunner,
      analyzeSplits(evenSplits, 5),
    );
    expect(insights).toContain(
      "Even split — both halves within 1 second per kilometre",
    );
  });
});
