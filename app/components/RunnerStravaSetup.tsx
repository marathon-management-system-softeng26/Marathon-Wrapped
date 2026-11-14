"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AppHeader from "./AppHeader";
import StravaCard from "./StravaCard";
import { callbackFeedback, callbackNotice, routeToStrava } from "@/lib/strava/viewModel";
import type { WrappedPayloadStrava } from "@/lib/wrappedPayload";

type RouteBody = Parameters<typeof routeToStrava>[0];

export default function RunnerStravaSetup({ runnerId, feedbackCode = null }: { runnerId: string; feedbackCode?: string | null }) {
  const [data, setData] = useState<WrappedPayloadStrava | null>(null),
    [error, setError] = useState(""),
    [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((value) => value + 1), []);
  // The server reads the OAuth return code, so the notice renders identically on both
  // sides and needs no state; the effect below only strips it from the address bar.
  const notice = feedbackCode === null ? "" : callbackNotice(feedbackCode);

  useEffect(() => {
    // Consume the one-time provider feedback so a reload cannot replay it.
    const feedback = callbackFeedback(window.location.href);
    if (feedback) window.history.replaceState(null, "", feedback.path);
  }, []);

  // Reads stay owner-scoped on the server; this only renders the stored state it returns.
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/runners/${encodeURIComponent(runnerId)}/strava`, {
      cache: "no-store",
      credentials: "same-origin",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]),
    })
      .then(async (response) => {
        if (controller.signal.aborted) return;
        // An expired session is recoverable only at sign-in, so do not strand the runner here.
        if (response.status === 401) {
          window.location.replace("/login");
          return;
        }
        if (!response.ok) {
          throw new Error(response.status === 404
            ? "This registration is not available on your account."
            : "Strava setup is unavailable. Try again.");
        }
        const body = await response.json() as RouteBody;
        if (controller.signal.aborted) return;
        setData(routeToStrava(body));
        setError("");
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Strava setup is unavailable. Try again.");
      });
    return () => controller.abort();
  }, [runnerId, version]);

  return (
    <div className="workspace">
      <AppHeader />
      <main className="content runner-strava-setup">
        <h1>Strava for this race</h1>
        <p className="runner-strava-intro">
          Choose the activity you ran so your Wrapped uses your own race data. This race is set up on its own, and
          your other races stay as they are.
        </p>
        {notice && <p role="status" className="runner-strava-notice">{notice}</p>}
        {error && (
          <div className="runner-strava-error">
            <p role="alert">{error}</p>
            <button type="button" onClick={refresh}>Try again</button>
          </div>
        )}
        {!data && !error && <p role="status" className="loading">Loading your Strava setup…</p>}
        {data && !error && <StravaCard input={data} runnerId={runnerId} onRefresh={refresh} stravaFirst ownsState />}
        <div className="runner-strava-links">
          {data?.state === "connected" && (
            <Link className="button" href={`/wrapped/${encodeURIComponent(runnerId)}`} prefetch={false}>View Wrapped</Link>
          )}
          <Link className="button secondary" href="/" prefetch={false}>Back to your races</Link>
        </div>
      </main>
    </div>
  );
}
