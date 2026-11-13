"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { WrappedPayloadStrava } from "@/lib/wrappedPayload";
import { runStravaAction, stravaViewModel, type StravaActionId } from "@/lib/strava/viewModel";

type Props = {
  input: WrappedPayloadStrava;
  runnerId: string;
  onRefresh: () => void;
  onLocalDisconnect?: () => void;
  stravaFirst?: boolean;
  /** Whether this card, rather than its parent, holds and refreshes the Strava state. */
  ownsState?: boolean;
};

export default function StravaCard({ input, runnerId, onRefresh, onLocalDisconnect, stravaFirst = false, ownsState = !stravaFirst }: Props) {
  const [source, setSource] = useState(input);
  const [data, setData] = useState(input);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const status = useRef<HTMLParagraphElement>(null);
  // Reconcile a refreshed Wrapped payload without remounting or losing keyboard focus.
  if (source !== input) { setSource(input); setData(input); }
  useEffect(() => () => controller.current?.abort(), []);

  const act = useCallback(async (action: Exclude<StravaActionId, "connect"> | "confirm", activityId?: string, automatic = false) => {
    if (busy.current) return;
    if (!ownsState && action === "check") {
      onRefresh();
      return;
    }
    busy.current = true;
    setPending(true);
    setFailed(false);
    if (!automatic) setFeedback(action === "confirm" ? "Confirming your race activity…" : action === "disconnect" ? "Disconnecting Strava…" : "Checking Strava…");
    const request = new AbortController();
    // A disconnect can finish after the runner moves to another recap scene.
    if (action !== "disconnect" || !onLocalDisconnect) controller.current = request;
    try {
      const next = await runStravaAction(fetch, runnerId, action, activityId, AbortSignal.any([request.signal, AbortSignal.timeout(12000)]));
      if (request.signal.aborted) return;
      if (action === "disconnect" &&
          (next.state === "disconnected" || next.state === "disconnecting" || next.reauthorizeToDisconnect)) {
        onLocalDisconnect?.();
      }
      if (ownsState) setData(next);
      if (!automatic) setFeedback(next.state === "connected" ? "Your race activity is selected." : next.state === "disconnected" ? "Strava disconnected." : "Strava status updated.");
      onRefresh();
    } catch (error) {
      if (request.signal.aborted) return;
      setFailed(true);
      setFeedback(error instanceof Error && ["Sign in again to update Strava.", "This activity has changed. Check status and choose again."].includes(error.message)
        ? error.message : "Strava could not update. Check status to try again.");
    } finally {
      busy.current = false;
      if (!request.signal.aborted) {
        setPending(false);
        if (!automatic) status.current?.focus({ preventScroll: true });
      }
    }
  }, [runnerId, onRefresh, onLocalDisconnect, ownsState]);

  useEffect(() => {
    if (!ownsState || !["importing", "building", "disconnecting"].includes(data.state)) return;
    let cancelled = false;
    let checks = 0;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (cancelled) return;
      await act("check", undefined, true);
      if (!cancelled && ++checks < 12) timer = setTimeout(poll, 5000);
    };
    timer = setTimeout(poll, 5000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [data.state, act, ownsState]);

  const model = stravaViewModel(data, runnerId, pending);
  return (
    <section className="enrichment strava-card" aria-label="Strava activity" aria-busy={pending}>
      <h3>{model.title}</h3>
      <p>{stravaFirst && data.state === "importing" ? "Check back for your Strava recap." : model.description}</p>
      {!stravaFirst && <p className="strava-baseline">{model.baselineCopy}</p>}
      {model.metrics.length > 0 && <dl className="metric-list">{model.metrics.map((metric) => <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>)}</dl>}
      {data.state === "connected" && model.metrics.length === 0 && <p>No measurements are available for this activity.</p>}
      {data.state === "connected" && data.metrics?.avg_cadence != null && <p className="strava-baseline">Cadence is shown as supplied by Strava, without converting it to steps per minute.</p>}
      {model.candidates.length > 0 && <ul className="strava-candidates" aria-label="Activities to confirm">{model.candidates.map((candidate) => (
        <li key={candidate.activityId}>
          <p><strong>{candidate.label}</strong></p><p>{candidate.note}</p>
          <button type="button" disabled={pending} aria-label={`Use activity ${candidate.label}`} onClick={() => void act("confirm", candidate.activityId)}>Use this activity</button>
        </li>
      ))}</ul>}
      <div className="strava-actions">{model.actions.map((action) => action.id === "connect" ? (
        <form action={action.path} method="post" key={action.id} onSubmit={(event) => {
          if (busy.current) { event.preventDefault(); return; }
          busy.current = true; setPending(true); setData({ ...data, state: "authorizing", metrics: null }); setFeedback("Opening Strava authorization…");
        }}>
          <input type="hidden" name="runnerId" value={runnerId} />
          <button type="submit" disabled={action.disabled}>{action.label}</button>
        </form>
      ) : <button type="button" className={action.id === "disconnect" ? "secondary" : undefined} disabled={action.disabled} key={action.id} onClick={() => void act(action.id as Exclude<StravaActionId, "connect">)}>{action.label}</button>)}</div>
      <p ref={status} className="strava-feedback" role={failed ? "alert" : "status"} aria-atomic="true" tabIndex={-1}>{feedback}</p>
    </section>
  );
}
