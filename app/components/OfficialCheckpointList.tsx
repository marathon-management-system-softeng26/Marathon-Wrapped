import { formatMmSs } from "@/lib/format";
import type { RecapPerformance } from "@/lib/recapViewModel";

export default function OfficialCheckpointList({ checkpoints }: { checkpoints: RecapPerformance["splits"] }) {
  if (!checkpoints.length) return <p>No official checkpoints available.</p>;
  const hasMockSplits = checkpoints.some((checkpoint) => checkpoint.isMock);
  return (
    <>
      {hasMockSplits && <p className="subtle" role="note">Estimated demo splits based on your official finish time.</p>}
      <ol className="official-checkpoint-list" aria-label="Official race checkpoints">
        {checkpoints.map((checkpoint) => (
          <li key={`${checkpoint.label}-${checkpoint.distanceMeters ?? "unknown"}`}>
            <div className="checkpoint-heading">
              <strong>{checkpoint.label}</strong>
              <div className="checkpoint-meta">
                {checkpoint.isMock && <span className="checkpoint-badge">Estimated</span>}
                {checkpoint.distanceMeters !== null && <span>{(checkpoint.distanceMeters / 1000).toFixed(1)} km</span>}
              </div>
            </div>
            <dl className="checkpoint-times">
              <div><dt>Elapsed</dt><dd>{checkpoint.elapsedMs === null ? "Unavailable" : formatMmSs(checkpoint.elapsedMs / 1000)}</dd></div>
              <div><dt>Split</dt><dd>{checkpoint.splitMs === null ? "Unavailable" : formatMmSs(checkpoint.splitMs / 1000)}</dd></div>
            </dl>
          </li>
        ))}
      </ol>
    </>
  );
}
