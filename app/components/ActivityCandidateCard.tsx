import type { StravaCandidateView } from "@/lib/strava/viewModel";

export default function ActivityCandidateCard({ candidate, selected, onSelect, disabled = false }: {
  candidate: StravaCandidateView;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <article className={`activity-candidate${selected ? " activity-candidate-selected" : ""}`}>
      <p className="activity-candidate-sport">{candidate.sportType}</p>
      <h4>{candidate.label}</h4>
      <p>{candidate.note}</p>
      <p className="activity-candidate-reason">{candidate.matchReason}</p>
      <button type="button" disabled={disabled} aria-pressed={selected} aria-label={`Use activity ${candidate.label}`} onClick={onSelect}>
        {selected ? "Selected activity" : "Use this activity"}
      </button>
    </article>
  );
}
