import Link from "next/link";
import { useId } from "react";
import type { CatalogRunner } from "@/lib/runnerCatalog";

// Only a ready snapshot opens the showcase; every other next step belongs to the
// per-runner Strava setup screen, which stays directly reachable from each card.
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

export default function RunnerWorkflowCard({ runner }: { runner: CatalogRunner }) {
  const detailsId = useId();
  const action = actions[runner.primaryAction];
  return (
    <li className="runner-row">
      <div id={detailsId}>
        <h3>{runner.name}</h3>
        <p>{runner.event}</p>
        <p className="runner-row-details">
          <span>{runner.category}</span>
          <span>{runner.bib_number ? `BIB ${runner.bib_number}` : "BIB unassigned"}</span>
        </p>
      </div>
      {action.kind !== "status" ? (
        <Link
          className="button"
          href={action.kind === "wrapped"
            ? `/wrapped/${encodeURIComponent(runner.id)}`
            : `/runners/${encodeURIComponent(runner.id)}/strava`}
          prefetch={false}
          aria-describedby={detailsId}
        >
          {action.label}
        </Link>
      ) : (
        <p role="status" className="runner-workflow-status">{action.label}</p>
      )}
    </li>
  );
}
