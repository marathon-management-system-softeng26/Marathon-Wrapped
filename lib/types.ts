export type Gender = "M" | "F";
export type CategoryName = "5K" | "10K";
export type StartStatus = "on-time" | "late" | "dns";
export type SplitType = "negative" | "positive" | "even";

export type ChipSplit = {
  km_marker: number;
  split_seconds: number;
};

export type FastestKm = {
  km_marker: number;
  split_seconds: number;
};

export type SplitAnalysis = {
  fastest_km: FastestKm | null;
  split_type: SplitType | null;
  first_half_seconds: number | null;
  second_half_seconds: number | null;
  slowed_after_km: number | null;
};

export type RunnerChipInput = {
  runner_id: string;
  bib_number: string | null;
  name: string;
  gender: Gender;
  age: number;
  event: string;
  category: CategoryName;
  distance_km: number;
  start_status: StartStatus;
  elapsed_seconds: number | null;
  avg_pace_sec_km: number | null;
  category_rank: number | null;
  overall_rank: number | null;
  category_percentile: number | null;
  finisher: boolean;
  splits: ChipSplit[];
};

export type WrappedStats = RunnerChipInput &
  SplitAnalysis & {
    insights: string[];
  };
