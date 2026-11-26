import Link from "next/link";
import { useId } from "react";
import type { CatalogRunner } from "@/lib/runnerCatalog";

const actions = {
  connect: { label: "Connect Strava", kind: "setup" },
  attach: { label: "Use Strava for this race", kind: "setup" },
  check_authorization: { label: "Check Strava authorization", kind: "setup" },
  importing: { label: "Finding your race activity…", kind: "status" },
  confirm: { label: "Choose your race activity", kind: "setup" },
  review_import: { label: "Check your Strava activity", kind: "setup" },
  building: { label: "Building your Wrapped…", kind: "status" },
  failed: { label: "Wrapped is unavailable", kind: "status" },
  reauthorize: { label: "Reconnect Strava", kind: "setup" },
  view: { label: "View Wrapped", kind: "wrapped" },
} as const satisfies Record<CatalogRunner["primaryAction"], { label: string; kind: "setup" | "wrapped" | "status" }>;

export default function RacePassCard({ runner }: { runner: CatalogRunner }) {
  const detailsId = useId();
  const action = actions[runner.primaryAction];
  const stravaHref = `/runners/${encodeURIComponent(runner.id)}/strava`;
  return (
    <li className="registration-card race-pass-card">
      <div id={detailsId}>
        <p className="race-pass-event">{runner.event}</p>
        <h3>{runner.name}</h3>
        <p className="registration-meta">
          <span>{runner.category}</span>
          <span>{runner.bib_number ? `BIB ${runner.bib_number}` : "BIB unassigned"}</span>
        </p>
      </div>
      <div className="race-pass-actions">
        {action.kind !== "status" ? (
          <Link
            className={action.kind === "setup" ? "button strava-action" : "button"}
            href={action.kind === "wrapped" ? `/wrapped/${encodeURIComponent(runner.id)}` : stravaHref}
            prefetch={false}
            aria-describedby={detailsId}
          >
            {action.label}
          </Link>
        ) : <p role="status" className="runner-workflow-status">{action.label}</p>}
        {runner.wrappedAvailable && runner.workflowState !== "ready" && (
          <Link className="race-pass-enrichment" href={stravaHref} prefetch={false} aria-describedby={detailsId}>
            Add details from Strava
          </Link>
        )}
        <Link className="race-pass-enrichment" href={`/runners/${encodeURIComponent(runner.id)}/photos`} prefetch={false} aria-describedby={detailsId}>
          Manage photos
        </Link>
      </div>
    </li>
  );
}
