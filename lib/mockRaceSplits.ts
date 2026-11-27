export type MockRaceSplit = {
  kilometer: number;
  distanceMeters: number;
  splitSeconds: number;
  elapsedSeconds: number;
};

function stableWeight(seed: string, kilometer: number): number {
  let hash = 2_166_136_261;
  for (const character of `${seed}:${kilometer}`) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return 95 + (hash >>> 0) % 11;
}

export function generateMockRaceSplits(totalMs: number, distanceKm: 5 | 10, seed: string): MockRaceSplit[] {
  if (!Number.isFinite(totalMs) || totalMs <= 0) return [];
  const weights = Array.from({ length: distanceKm }, (_, index) => stableWeight(seed, index + 1));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  let elapsedMs = 0;
  return weights.map((weight, index) => {
    const kilometer = index + 1;
    const splitMs = index === weights.length - 1
      ? totalMs - elapsedMs
      : Math.max(1, Math.round(totalMs * weight / weightTotal));
    elapsedMs += splitMs;
    return {
      kilometer,
      distanceMeters: kilometer * 1_000,
      splitSeconds: splitMs / 1_000,
      elapsedSeconds: elapsedMs / 1_000,
    };
  });
}
