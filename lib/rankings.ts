import type { RecapPerformance } from "./recapViewModel";

const genderGroup = (gender: string | null) => {
  const value = gender?.trim().toLowerCase();
  if (value === "f" || value === "female" || value === "women") return "women";
  if (value === "m" || value === "male" || value === "men") return "men";
  return value ? `in ${gender!.trim()}` : "in gender";
};

/** Official placements for a finisher, e.g. ["#12 overall", "#4 in F30", "#9 women"]. */
export function formatRankings(performance: RecapPerformance): string[] {
  const parts: string[] = [];
  if (performance.overallRank !== null) parts.push(`#${performance.overallRank} overall`);
  if (performance.divisionRank !== null) parts.push(`#${performance.divisionRank} in ${performance.division ?? "division"}`);
  if (performance.genderRank !== null) parts.push(`#${performance.genderRank} ${genderGroup(performance.gender)}`);
  return parts;
}
