import type { ChipSplit, RunnerChipInput } from "@/lib/types";

export const ainaSplits: ChipSplit[] = [
  { km_marker: 1, split_seconds: 312 },
  { km_marker: 2, split_seconds: 305 },
  { km_marker: 3, split_seconds: 318 },
  { km_marker: 4, split_seconds: 298 },
  { km_marker: 5, split_seconds: 290 },
];
// 312+305+318+298+290 = 1523
// first half km1-2 = 617; second half km4-5 = 588; |29| > 2 → negative
// fastest = km 5 / 290; only slowdown is km2→3 (+13) → slowed_after_km = 2

export const budiSplits: ChipSplit[] = [
  { km_marker: 1, split_seconds: 340 },
  { km_marker: 2, split_seconds: 338 },
  { km_marker: 3, split_seconds: 336 },
  { km_marker: 4, split_seconds: 334 },
  { km_marker: 5, split_seconds: 332 },
  { km_marker: 6, split_seconds: 350 },
  { km_marker: 7, split_seconds: 355 },
  { km_marker: 8, split_seconds: 360 },
  { km_marker: 9, split_seconds: 365 },
  { km_marker: 10, split_seconds: 370 },
];
// first 1-5 = 1680; second 6-10 = 1800; |120| > 5 → positive
// fastest = km 5 / 332; largest slowdown km5→6 (+18) → slowed_after_km = 5

export const evenSplits: ChipSplit[] = [
  { km_marker: 1, split_seconds: 300 },
  { km_marker: 2, split_seconds: 300 },
  { km_marker: 3, split_seconds: 300 },
  { km_marker: 4, split_seconds: 301 },
  { km_marker: 5, split_seconds: 299 },
];
// first = 600; second = 600; |0| <= 2 → even
// fastest tie 299 vs 300s → km 5; slowdown km3→4 (+1) → slowed_after_km = 3

export function ainaInput(): RunnerChipInput {
  return {
    runner_id: "11111111-1111-1111-1111-111111111111",
    bib_number: "A1001",
    name: "Aina Putri",
    gender: "F",
    age: 24,
    event: "Soekarno Run 2027",
    category: "5K",
    distance_km: 5,
    start_status: "on-time",
    elapsed_seconds: 1523,
    avg_pace_sec_km: 304.6,
    category_rank: 1,
    overall_rank: 2,
    category_percentile: 1,
    finisher: true,
    splits: ainaSplits,
  };
}
