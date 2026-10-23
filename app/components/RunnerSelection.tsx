"use client";
import Link from "next/link";
import AppHeader from "./AppHeader";
import { useCatalog } from "./useCatalog";
export default function RunnerSelection() {
  const { data, error, retry } = useCatalog();
  return (
    <div className="workspace">
      <AppHeader />
      <main className="content">
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
        {error ? (
          <div role="alert">
            <p>{error}</p>
            <button onClick={retry}>Try again</button>
          </div>
        ) : !data ? (
          <p role="status" className="loading">
            Finding your races…
          </p>
        ) : (
          <>
            <div className="runner-list">
              {data.runners.map((runner) => (
                <Link
                  className="runner-row"
                  key={runner.id}
                  href={`/wrapped/${runner.id}`}
                >
                  <span>
                    <b>{runner.name}</b>
                    <small>BIB {runner.bib_number ?? "unassigned"}</small>
                  </span>
                  <span aria-hidden="true">View recap →</span>
                </Link>
              ))}
            </div>
            {!data.runners.length && (
              <p>
                No runner is linked to your account yet. Ask the organizer to
                link your race registration.
              </p>
            )}
            {!!data.events.length && (
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
