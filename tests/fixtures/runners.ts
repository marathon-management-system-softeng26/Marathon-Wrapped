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
// fastest km 5 at 299s (sole minimum); slowdown km3→4 (+1) → slowed_after_km = 3

export const fastestKmTieSplits: ChipSplit[] = [
  { km_marker: 1, split_seconds: 300 },
  { km_marker: 2, split_seconds: 299 },
  { km_marker: 3, split_seconds: 299 },
  { km_marker: 4, split_seconds: 301 },
  { km_marker: 5, split_seconds: 301 },
];
// tied fastest 299s at km 2 and 3 → lower km_marker wins (km 2)

export const incompleteSplits: ChipSplit[] = [
  { km_marker: 1, split_seconds: 312 },
  { km_marker: 2, split_seconds: 305 },
  { km_marker: 4, split_seconds: 298 },
];

export function citraDnfInput(): RunnerChipInput {
  return {
    runner_id: "22222222-2222-2222-2222-222222222222",
    bib_number: "A1002",
    name: "Citra Lestari",
    gender: "F",
    age: 29,
    event: "Soekarno Run 2027",
    category: "5K",
    distance_km: 5,
    start_status: "on-time",
    elapsed_seconds: null,
    avg_pace_sec_km: null,
    category_rank: null,
    overall_rank: null,
    category_percentile: null,
    finisher: false,
    splits: [
      { km_marker: 1, split_seconds: 320 },
      { km_marker: 2, split_seconds: 330 },
    ],
  };
}

export function dewaDnsInput(): RunnerChipInput {
  return {
    runner_id: "33333333-3333-3333-3333-333333333333",
    bib_number: "A1003",
    name: "Dewa Ngurah",
    gender: "M",
    age: 31,
    event: "Soekarno Run 2027",
    category: "10K",
    distance_km: 10,
    start_status: "dns",
    elapsed_seconds: null,
    avg_pace_sec_km: null,
    category_rank: null,
    overall_rank: null,
    category_percentile: null,
    finisher: false,
    splits: [],
  };
}

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
