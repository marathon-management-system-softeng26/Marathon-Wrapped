import type { ChipSplit, SplitAnalysis, SplitType } from "./types";

export function computeElapsedSeconds(start: Date, finish: Date): number {
  return Math.round((finish.getTime() - start.getTime()) / 1000);
}

export function computeAvgPaceSecKm(
  elapsedSeconds: number,
  distanceKm: number,
): number {
  return elapsedSeconds / distanceKm;
}

export function rankAmong(
  elapsedSeconds: number,
  peerElapsedSeconds: number[],
): number {
  const faster = peerElapsedSeconds.filter((other) => other < elapsedSeconds)
    .length;
  return 1 + faster;
}

export function categoryPercentile(
  elapsedSeconds: number,
  peerElapsedSeconds: number[],
): number {
  const n = peerElapsedSeconds.length;
  if (n <= 1) return 0;
  const slower = peerElapsedSeconds.filter((other) => other > elapsedSeconds)
    .length;
  const rank = 1 + slower;
  return (rank - 1) / (n - 1);
}

export function analyzeSplits(
  splits: ChipSplit[],
  distanceKm: number,
): SplitAnalysis {
  const byKm = [...splits].sort((a, b) => a.km_marker - b.km_marker);

  const fastest_km =
    byKm.length === 0
      ? null
      : byKm.reduce((best, row) =>
          row.split_seconds < best.split_seconds ||
          (row.split_seconds === best.split_seconds &&
            row.km_marker < best.km_marker)
            ? row
            : best,
        );

  let slowed_after_km: number | null = null;
  let worstDelta = 0;
  for (let i = 0; i < byKm.length - 1; i++) {
    const current = byKm[i];
    const next = byKm[i + 1];
    if (next.km_marker - current.km_marker !== 1) continue;
    const delta = next.split_seconds - current.split_seconds;
    if (delta > worstDelta) {
      worstDelta = delta;
      slowed_after_km = current.km_marker;
    }
  }

  const expected = Array.from({ length: distanceKm }, (_, i) => i + 1);
  const present = new Set(byKm.map((row) => row.km_marker));
  const complete = expected.every((km) => present.has(km));

  if (!complete) {
    return {
      fastest_km,
      split_type: null,
      first_half_seconds: null,
      second_half_seconds: null,
      slowed_after_km,
    };
  }

  const lookup = new Map(byKm.map((row) => [row.km_marker, row.split_seconds]));
  const half = Math.floor(distanceKm / 2);
  const first = sumRange(lookup, 1, half);
  const second = sumRange(lookup, distanceKm - half + 1, distanceKm);
  const tolerance = half;

  let split_type: SplitType;
  if (Math.abs(first - second) <= tolerance) split_type = "even";
  else if (second < first) split_type = "negative";
  else split_type = "positive";

  return {
    fastest_km,
    split_type,
    first_half_seconds: first,
    second_half_seconds: second,
    slowed_after_km,
  };
}

function sumRange(
  lookup: Map<number, number>,
  fromKm: number,
  toKm: number,
): number {
  let total = 0;
  for (let km = fromKm; km <= toKm; km++) {
    total += lookup.get(km) ?? 0;
  }
  return total;
}
