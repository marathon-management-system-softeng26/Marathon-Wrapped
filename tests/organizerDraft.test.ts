import { it, expect } from "vitest";
import { changeDraftCategory } from "@/lib/organizerDraft";
import type { HeroRunnerDraft } from "@/lib/heroValidation";
it("discards hidden out-of-distance splits when changing 10K to 5K", () => {
  const draft = {
    category: "10K",
    splits: Array.from({ length: 10 }, (_, i) => ({
      km_marker: i + 1,
      split_seconds: 300,
    })),
  } as HeroRunnerDraft;
  const changed = changeDraftCategory(draft, "5K");
  expect(changed.category).toBe("5K");
  expect(changed.splits.map((s) => s.km_marker)).toEqual([1, 2, 3, 4, 5]);
  expect(draft.splits).toHaveLength(10);
});
