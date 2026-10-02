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
