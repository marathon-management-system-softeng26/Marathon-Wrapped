import { formatMmSs } from "@/lib/format";
import type { RecapPerformance } from "@/lib/recapViewModel";

export default function OfficialCheckpointList({ checkpoints }: { checkpoints: RecapPerformance["splits"] }) {
  if (!checkpoints.length) return <p>No official checkpoints available.</p>;
  return (
    <ol className="official-checkpoint-list" aria-label="Official race checkpoints">
      {checkpoints.map((checkpoint) => (
        <li key={`${checkpoint.label}-${checkpoint.distanceMeters ?? "unknown"}`}>
          <strong>{checkpoint.label}</strong>
          {checkpoint.distanceMeters !== null && <span>{(checkpoint.distanceMeters / 1000).toFixed(1)} km</span>}
          <dl>
            <div><dt>Elapsed</dt><dd>{checkpoint.elapsedMs === null ? "Unavailable" : formatMmSs(checkpoint.elapsedMs / 1000)}</dd></div>
            <div><dt>Split</dt><dd>{checkpoint.splitMs === null ? "Unavailable" : formatMmSs(checkpoint.splitMs / 1000)}</dd></div>
          </dl>
        </li>
      ))}
    </ol>
  );
}
