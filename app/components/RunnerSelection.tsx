"use client";
import AppHeader from "./AppHeader";
import RunnerClaimForm from "./RunnerClaimForm";
import RunnerWorkflowCard from "./RunnerWorkflowCard";
import { useCatalog } from "./useCatalog";
export default function RunnerSelection() {
  const { data, error, retry } = useCatalog();
  return (
    <div className="workspace">
      <AppHeader showOrganizerLink={!!data?.events.length} />
      <main className="content runner-dashboard">
        <h1 className="page-title">
          Your <span>races.</span>
        </h1>
        <p className="page-subtitle">
          Find your finish, revisit the kilometers, and keep a little of race
          day.
        </p>
        {error && (
          <div className="dashboard-error">
            <p role="alert">{error}</p>
            <button type="button" onClick={retry}>Try again</button>
          </div>
        )}
        {!data && !error && (
          <>
            <p role="status" className="loading-note">
              Finding your races…
            </p>
            {/* Placeholders only, so the page keeps its shape while the catalog loads. They are
                not list items: the registrations themselves are the only entries in that list. */}
            <div className="registration-grid" aria-hidden="true">
              <div className="registration-card registration-skeleton" />
              <div className="registration-card registration-skeleton" />
              <div className="registration-card registration-skeleton" />
            </div>
          </>
        )}
        {data && (
          <>
            {data.runners.length > 0 && (
              <section className="runner-registrations" aria-labelledby="runner-registrations-heading">
                <h2 id="runner-registrations-heading">Your registrations</h2>
                <ul className="registration-grid" role="list">
                  {data.runners.map((runner) => <RunnerWorkflowCard key={runner.id} runner={runner} />)}
                </ul>
              </section>
            )}
            <RunnerClaimForm onClaimed={retry} />
          </>
        )}
      </main>
    </div>
  );
}
