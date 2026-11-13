import { formatMmSs } from "@/lib/format";
import type { StravaWrappedSnapshotV1 } from "@/lib/strava/projection";

type Props = Pick<StravaWrappedSnapshotV1, "splits" | "fastestKilometer" | "paceTrend">;

const trendCopy = { faster: "Faster finish", slower: "Slower finish", even: "Even pace" } as const;

/** Renders only the kilometer data Strava supplied; absent values get absence copy, never a zero bar. */
export default function StravaSplitChart({ splits, fastestKilometer, paceTrend }: Props) {
  if (!splits.length) return <p>No kilometer splits available.</p>;
  const longest = Math.max(1, ...splits.map((split) => split.movingSeconds));
  return (
    <>
      <div className="split-chart" role="img" aria-label="Kilometer moving times. Taller bars indicate longer times.">
        {splits.map((split) => (
          <div key={split.kilometer}>
            <span
              style={{ height: `${Math.max(20, (split.movingSeconds / longest) * 145)}px` }}
              className={split.kilometer === fastestKilometer?.kilometer ? "fast" : ""}
            />
            <b>{split.kilometer}</b>
            <small>{formatMmSs(split.movingSeconds)}</small>
          </div>
        ))}
      </div>
      {fastestKilometer && (
        <p className="lime">
          Fastest kilometer {fastestKilometer.kilometer} &#183; {formatMmSs(fastestKilometer.paceSecondsPerKm)} /km
        </p>
      )}
      {paceTrend && (
        <p className="split-trend">
          {trendCopy[paceTrend.direction]} &#183; {formatMmSs(paceTrend.earlyPaceSecondsPerKm)} /km early,
          {" "}{formatMmSs(paceTrend.latePaceSecondsPerKm)} /km late
        </p>
      )}
    </>
  );
}
