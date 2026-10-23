import type { RunnerChipInput } from "./types";

export class InvalidRunnerDataError extends Error {
  constructor() {
    super("The stored race result is inconsistent or incomplete.");
    this.name = "InvalidRunnerDataError";
  }
}

function invalid(): never {
  throw new InvalidRunnerDataError();
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) invalid();
  return value;
}

function numeric(value: unknown, minimum: number, maximum = Infinity, integer = false): number {
  if (typeof value === "string") {
    if (!/^-?\d+(\.\d+)?$/.test(value.trim())) invalid();
    value = Number(value);
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) invalid();
  return value;
}

function nullableNumber(value: unknown, minimum: number, maximum = Infinity, integer = false): number | null {
  return value === null ? null : numeric(value, minimum, maximum, integer);
}

export function isRunnerId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** Validate the database boundary and whitelist the shared public contract. */
export function validateRunnerChipInput(value: unknown): RunnerChipInput {
  const row = record(value);
  const runner_id = text(row.runner_id);
  if (!isRunnerId(runner_id)) invalid();
  const category = row.category;
  if (category !== "5K" && category !== "10K") invalid();
  const distance_km = numeric(row.distance_km, 5, 10, true);
  if (distance_km !== (category === "5K" ? 5 : 10)) invalid();
  const gender = row.gender;
  if (gender !== "M" && gender !== "F") invalid();
  const start_status = row.start_status;
  if (start_status !== "on-time" && start_status !== "late" && start_status !== "dns") invalid();
  if (typeof row.finisher !== "boolean") invalid();
  const finisher = row.finisher;
  if (finisher && start_status === "dns") invalid();

  const elapsed_seconds = nullableNumber(row.elapsed_seconds, 1, Infinity, true);
  const avg_pace_sec_km = nullableNumber(row.avg_pace_sec_km, Number.MIN_VALUE);
  const category_rank = nullableNumber(row.category_rank, 1, Infinity, true);
  const overall_rank = nullableNumber(row.overall_rank, 1, Infinity, true);
  const category_percentile = nullableNumber(row.category_percentile, 0, 1);
  const finishFields = [elapsed_seconds, avg_pace_sec_km, category_rank, overall_rank, category_percentile];
  if (finisher ? finishFields.some(field => field === null) : finishFields.some(field => field !== null)) invalid();
  if (finisher && Math.abs(avg_pace_sec_km! - elapsed_seconds! / distance_km) > 0.011) invalid();

  // Repository callers supply raw timestamps for a second timing consistency check.
  if ("start_time" in row || "finish_time" in row) {
    const timestamp = (input: unknown): number => {
      if (typeof input !== "string") invalid();
      const result = Date.parse(input);
      return Number.isFinite(result) ? result : invalid();
    };
    if (finisher) {
      const start = timestamp(row.start_time);
      const finish = timestamp(row.finish_time);
      if (finish <= start || Math.round((finish - start) / 1000) !== elapsed_seconds) invalid();
    } else {
      if (row.finish_time != null) invalid();
      if (start_status !== "dns" && row.start_time == null) invalid();
      if (row.start_time != null) timestamp(row.start_time);
      if (start_status === "dns" && row.start_time != null) invalid();
    }
  }

  if (!Array.isArray(row.splits)) invalid();
  const markers = new Set<number>();
  const splits = row.splits.map(value => {
    const split = record(value);
    const km_marker = numeric(split.km_marker, 1, distance_km, true);
    if (markers.has(km_marker)) invalid();
    markers.add(km_marker);
    return { km_marker, split_seconds: numeric(split.split_seconds, Number.MIN_VALUE) };
  }).sort((a, b) => a.km_marker - b.km_marker);

  return {
    runner_id, bib_number: row.bib_number === null ? null : text(row.bib_number),
    name: text(row.name), gender, age: numeric(row.age, 0, 150, true),
    event: text(row.event), category, distance_km, start_status, finisher,
    elapsed_seconds, avg_pace_sec_km, category_rank, overall_rank,
    category_percentile, splits,
  };
}
