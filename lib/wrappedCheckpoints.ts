import type { OfficialCheckpoint } from "./officialResults/types";

export type WrappedCheckpointRow = OfficialCheckpoint;

/** Preserve the published ScoreNow checkpoint contract without inventing km indexes or times. */
export function toWrappedCheckpointRows(checkpoints: OfficialCheckpoint[]): WrappedCheckpointRow[] {
  return [...checkpoints]
    .sort((a, b) => a.sequence - b.sequence)
    .map((checkpoint) => ({ ...checkpoint }));
}
