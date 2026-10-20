import type { HeroRunnerDraft } from "./heroValidation";
export function changeDraftCategory(
  draft: HeroRunnerDraft,
  category: "5K" | "10K",
): HeroRunnerDraft {
  return {
    ...draft,
    category,
    splits: draft.splits.filter(
      (split) => split.km_marker <= (category === "5K" ? 5 : 10),
    ),
  };
}
