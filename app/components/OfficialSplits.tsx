import { formatMmSs } from "@/lib/format";
import type { RecapPerformance } from "@/lib/recapViewModel";

function elapsedTime(milliseconds: number | null) {
  return milliseconds === null ? "Unavailable" : formatMmSs(milliseconds / 1000);
}

export default function OfficialSplits({ splits }: { splits: RecapPerformance["splits"] }) {
  if (!splits.length) return <p>No kilometer splits available.</p>;

  return (
    <div className="official-splits">
      <table aria-label="Official race checkpoints">
        <thead>
          <tr><th scope="col">Checkpoint</th><th scope="col">Elapsed</th><th scope="col">Split time</th></tr>
        </thead>
        <tbody>
          {splits.map((split, index) => (
            <tr key={index}>
              <th scope="row">{split.label}</th>
              <td>{elapsedTime(split.elapsedMs)}</td>
              <td>{elapsedTime(split.splitMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
