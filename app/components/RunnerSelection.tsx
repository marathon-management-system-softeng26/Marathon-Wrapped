"use client";
import Image from "next/image";
import Link from "next/link";
import AppHeader from "./AppHeader";
import RunnerClaimForm from "./RunnerClaimForm";
import RunnerWorkflowCard from "./RunnerWorkflowCard";
import RunnerFeedback from "./RunnerFeedback";
import { useCatalog } from "./useCatalog";
export default function RunnerSelection() {
  const { data, error, retry } = useCatalog();
  return (
    <div className="workspace runner-experience">
      <AppHeader showOrganizerLink={!!data?.events.length} />
      <main className="content runner-dashboard">
        <header className="race-hero">
          <div className="race-hero-copy">
            <p className="race-hero-brand">Soekarno Run · Marathon Wrapped</p>
            <h1 className="page-title">Your races.</h1>
            <p className="page-subtitle">Revisit your results, kilometer splits, and race-day photos.</p>
          </div>
          <figure className="race-hero-photo">
            <Image src="/photos/demo-race.jpg" width={861} height={1148} sizes="(max-width: 700px) 94vw, 520px" alt="Runners in motion at the Prague International Marathon" preload />
            <figcaption>Sample race photo · Martin Vorel</figcaption>
          </figure>
        </header>
        {error && (
          <div className="dashboard-error">
            <RunnerFeedback kind="error" title={error} />
            <button type="button" onClick={retry}>Try again</button>
          </div>
        )}
        {!data && !error && (
          <>
            <RunnerFeedback kind="status" title="Finding your races…" />
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
            <details className="runner-recovery" open={data.runners.length === 0}>
              <summary>{data.runners.length === 0 ? "Add your first race" : "Missing a race?"}</summary>
              <p><Link className="auth-primary-link" href="/register?link=1">Link an official race result</Link></p>
              <RunnerClaimForm onClaimed={retry} />
            </details>
          </>
        )}
      </main>
    </div>
  );
}
