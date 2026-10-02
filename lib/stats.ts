export function computeElapsedSeconds(start: Date, finish: Date): number {
  return Math.round((finish.getTime() - start.getTime()) / 1000);
}

export function computeAvgPaceSecKm(
  elapsedSeconds: number,
  distanceKm: number,
): number {
  return elapsedSeconds / distanceKm;
}
