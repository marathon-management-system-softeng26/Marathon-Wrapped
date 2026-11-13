"use client";
import Link from "next/link";
import AppHeader from "./AppHeader";
import RunnerClaimForm from "./RunnerClaimForm";
import RunnerWorkflowCard from "./RunnerWorkflowCard";
import { useCatalog } from "./useCatalog";
export default function RunnerSelection() {
  const { data, error, retry } = useCatalog();
  return (
    <div className="workspace">
      <AppHeader />
      <main className="content runner-dashboard">
        <h1>
          Your race.
          <br />
          <span>Your story.</span>
        </h1>
        <p className="lead">
          Find your finish, revisit the kilometers, and keep a little of race
          day.
        </p>
        <p className="demo-note">
          Prototype · Synthetic Soekarno Run 2027 results
        </p>
        {error && (
          <div>
            <p role="alert">{error}</p>
            <button type="button" onClick={retry}>Try again</button>
          </div>
        )}
        {!data && !error && (
          <p role="status" className="loading">
            Finding your races…
          </p>
        )}
        {data && (
          <>
            {data.runners.length > 0 && (
              <section className="runner-registrations" aria-labelledby="runner-registrations-heading">
                <h2 id="runner-registrations-heading">Your registrations</h2>
                <ul className="runner-list" role="list">
                  {data.runners.map((runner) => <RunnerWorkflowCard key={runner.id} runner={runner} />)}
                </ul>
              </section>
            )}
            <RunnerClaimForm onClaimed={retry} />
            {data.events.length > 0 && (
              <Link className="button secondary" href="/organizer">
                Manage event results
              </Link>
            )}
          </>
        )}
      </main>
    </div>
  );
}
