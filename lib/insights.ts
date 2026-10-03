import { formatMmSs } from "./format";
import type { RunnerChipInput, SplitAnalysis } from "./types";

export function buildInsights(
  input: RunnerChipInput,
  analysis: SplitAnalysis,
): string[] {
  const lines: string[] = [];

  if (input.start_status === "dns") {
    lines.push("Did not start");
    return lines;
  }

  if (!input.finisher) {
    lines.push("Did not finish — no official finish time");
  } else if (input.elapsed_seconds != null) {
    lines.push(`Finish time ${formatMmSs(input.elapsed_seconds)}`);
  }

  if (input.category_rank != null) {
    lines.push(`Category rank ${input.category_rank}`);
  }

  if (input.category_percentile != null) {
    const percent = Math.round(input.category_percentile * 100);
    lines.push(`Faster than ${percent}% of your category`);
  }

  if (analysis.fastest_km) {
    const { km_marker, split_seconds } = analysis.fastest_km;
    lines.push(
      `Fastest kilometre: km ${km_marker} in ${formatMmSs(split_seconds)}`,
    );
  }

  if (analysis.split_type === "negative") {
    lines.push("Negative split — second half faster than the first");
  } else if (analysis.split_type === "positive") {
    lines.push("Positive split — second half slower than the first");
  } else if (analysis.split_type === "even") {
    lines.push("Even split — both halves within 1 second per kilometre");
  }

  return lines;
}
