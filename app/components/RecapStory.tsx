"use client";
import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SharePreview from "./SharePreview";
import StravaCard from "./StravaCard";
import StravaSplitChart from "./StravaSplitChart";
import OfficialCheckpointList from "./OfficialCheckpointList";
import StoryProgress from "./StoryProgress";
import StoryControls from "./StoryControls";
import RunnerFeedback from "./RunnerFeedback";
import { buildRecapViewModel } from "@/lib/recapViewModel";
import { callbackFeedback } from "@/lib/strava/viewModel";
import type { Photo, RunnerWrappedPayload, StravaFirstWrappedPayload, WrappedPayloadStrava } from "@/lib/wrappedPayload";
import { formatMmSs } from "@/lib/format";
import { shareModel } from "@/lib/shareModel";
import { exportWrapped } from "@/lib/exportWrapped";
import { decorationUrl, recapDecorations } from "@/lib/recapDecorations";

const pages = ["Intro", "Your race", "Distance", "Splits", "Context", "Photos", "Save"] as const;
const workflowTitles: Record<Exclude<StravaFirstWrappedPayload["state"], "ready">, string> = {
  setup_required: "Connect Strava to create your Wrapped", authorizing: "Waiting for Strava authorization", importing: "Finding your race activity",
  needs_confirmation: "Choose your race activity", no_match: "No matching race activity found", building: "Building your Wrapped",
  failed: "Your Wrapped could not be built", reauth_required: "Reconnect your Strava account",
};
const stravaStates: Record<StravaFirstWrappedPayload["state"], WrappedPayloadStrava["state"]> = {
  setup_required: "disconnected", authorizing: "authorizing", importing: "importing", needs_confirmation: "needs_confirmation",
  no_match: "no_match", building: "importing", ready: "connected", failed: "unavailable", reauth_required: "reauthorize_required",
};
const outcomeCopy = {
  finished: "You crossed the finish with an official result.", dnf: "Your official result says you did not finish.",
  dns: "Your official result says you did not start.", dq: "Your official result was marked disqualified.",
  unknown: "Your official race record is available.",
} as const;

function isOfficial(payload: RunnerWrappedPayload): payload is Extract<RunnerWrappedPayload, { kind: "official" }> {
  return "kind" in payload && payload.kind === "official";
}
function RacePhoto({ photo, onOpen }: { photo: Photo; onOpen?: () => void }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <p className="photo-error">This photo could not load.</p>;
  const label = photo.source === "personal" ? "Your photo" : "Organizer photo";
  const image = <Image unoptimized width={861} height={1148} src={photo.photo_url}
    alt={onOpen ? "" : label} onError={() => setFailed(true)} />;
  return onOpen
    ? <button className="photo-button" onClick={onOpen}>{image}<span>{label}</span></button>
    : <>{image}{photo.photographer && <p>{photo.photographer}</p>}</>;
}

export default function RecapStory({ runnerId, initialPayload }: { runnerId: string; initialPayload?: RunnerWrappedPayload | null }) {
  const [payload, setPayload] = useState<RunnerWrappedPayload | null>(initialPayload ?? null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [slide, setSlide] = useState(0);
  const [notice, setNotice] = useState("");
  const [stravaFeedback, setStravaFeedback] = useState<{ notice: string; path: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Photo | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const loaded = useRef<string | null>(null);
  const wrappedRequest = useRef<AbortController | null>(null);
  const exportRequest = useRef<AbortController | null>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const refresh = useCallback(() => setVersion((value) => value + 1), []);
  const model = useMemo(() => payload ? buildRecapViewModel(payload) : null, [payload]);
  const strava = useMemo((): WrappedPayloadStrava | null => {
    if (!payload) return null;
    const source = isOfficial(payload) ? payload.strava : payload;
    if (source.state === "unavailable") return null;
    const snapshot = source.state === "ready" ? source.snapshot : null;
    return { state: stravaStates[source.state], metrics: snapshot ? { avg_heartrate: snapshot.averageHeartrate, max_heartrate: snapshot.maxHeartrate, elevation_gain_m: snapshot.elevationGainMeters, calories: snapshot.calories, avg_cadence: snapshot.averageCadence } : null, candidates: source.state === "needs_confirmation" ? source.candidates : undefined };
  }, [payload]);
  const invalidateWrapped = useCallback(() => {
    wrappedRequest.current?.abort(); exportRequest.current?.abort();
    setPayload((current) => !current ? current : isOfficial(current) ? { ...current, strava: { state: "unavailable" } } : { state: "setup_required", registration: current.registration });
    setSelected(null); setNotice("Strava is disconnected from your Wrapped.");
  }, []);

  useEffect(() => {
    const feedback = callbackFeedback(window.location.href);
    let cancelled = false;
    if (feedback) queueMicrotask(() => {
      if (!cancelled) { setStravaFeedback(feedback); setSlide(4); }
    });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (stravaFeedback) window.history.replaceState(window.history.state, "", stravaFeedback.path);
  }, [stravaFeedback]);
  useEffect(() => {
    if (initialPayload && version === 0) {
      loaded.current = runnerId;
      return;
    }
    const controller = new AbortController(); wrappedRequest.current = controller;
    fetch(`/api/runners/${encodeURIComponent(runnerId)}/wrapped`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) }).then(async (response) => {
      if (controller.signal.aborted) return; if (response.status === 401) { window.location.replace("/login"); return; }
      const body = await response.json(); if (controller.signal.aborted) return; if (!response.ok) throw new Error(body.error || "Your recap could not load.");
      loaded.current = runnerId; setPayload(body); setError("");
    }).catch((cause) => {
      if (!controller.signal.aborted) {
        if (loaded.current === runnerId) setNotice("Recap could not refresh. Try again in a moment.");
        else setError(cause.message);
      }
    });
    return () => controller.abort();
  }, [initialPayload, runnerId, version]);
  useEffect(() => () => exportRequest.current?.abort(), []);
  useEffect(() => { if (!payload || isOfficial(payload) || !["authorizing", "importing", "building"].includes(payload.state)) return; const timer = window.setTimeout(refresh, 5000); return () => window.clearTimeout(timer); }, [payload, refresh]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (dialog.current?.open || event.altKey || event.ctrlKey || event.metaKey || (event.target instanceof HTMLElement && event.target.closest("input,textarea,select,button,a,[contenteditable]"))) return; if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); setSlide((s) => Math.max(0, Math.min(6, s + (event.key === "ArrowRight" ? 1 : -1)))); } };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [slide]);
  useEffect(() => { if (selected) dialog.current?.showModal(); }, [selected]);

  async function save() {
    if (!payload || !model?.exportable) return; const controller = new AbortController(); exportRequest.current = controller; setSaving(true); setNotice("");
    try { await exportWrapped(payload, controller.signal); setNotice("PNG ready. Check your browser downloads."); }
    catch (cause) { if (!controller.signal.aborted) setNotice(cause instanceof Error ? cause.message : "Image could not be saved. Please retry."); }
    finally { exportRequest.current = null; setSaving(false); }
  }
  if (error || !payload) return <main className="story-state"><Link href="/">← Your races</Link><h1>{error ? "Your recap needs a moment." : "Finding your race…"}</h1>{error && <><RunnerFeedback kind="error" title={error} /><button onClick={refresh}>Try again</button></>}</main>;
  if (!isOfficial(payload) && payload.state !== "ready") {
    const { runner, event } = payload.registration;
    return <main className="story-state"><Link href="/">← Your races</Link><h1>{workflowTitles[payload.state]}</h1><p>{runner.name} · {event.name} · {event.category}</p>{payload.state === "failed" ? <RunnerFeedback kind="empty" title="A Wrapped recap is unavailable for this registration." /> : <>{stravaFeedback && <RunnerFeedback kind="status" title={stravaFeedback.notice} />}{strava && <StravaCard runnerId={runnerId} input={strava} onRefresh={refresh} onLocalDisconnect={invalidateWrapped} stravaFirst />}{notice && <RunnerFeedback kind="status" title={notice} />}<Link className="button" href={`/runners/${encodeURIComponent(runnerId)}/strava`} prefetch={false}>Set up Strava for this race</Link></>}</main>;
  }
  if (!model?.performance) return <main className="story-state"><h1>Your Wrapped could not be built</h1></main>;
  if (!isOfficial(payload)) { try { shareModel(payload); } catch { return <main className="story-state"><Link href="/">← Your races</Link><h1>Your Wrapped could not be built</h1><RunnerFeedback kind="empty" title="A Wrapped recap is unavailable for this registration." /><Link className="button" href={`/runners/${runnerId}/strava`}>Set up Strava for this race</Link></main>; } }

  const { registration, performance } = model;
  const firstName = registration.runner.name.trim().split(/\s+/)[0] || "Runner";
  const time = performance.elapsedMs === null ? "Official time unavailable" : formatMmSs(performance.elapsedMs / 1000);
  const pace = performance.averagePaceSecondsPerKm === null ? "Pace unavailable" : `${formatMmSs(performance.averagePaceSecondsPerKm)} /km`;
  const readySnapshot = !isOfficial(payload) && payload.state === "ready" ? payload.snapshot : null;
  const chartSplits = readySnapshot?.splits ?? performance.splits.flatMap((item, index) => item.splitMs === null ? [] : [{ kilometer: index + 1, distanceMeters: item.distanceMeters ?? 0, movingSeconds: item.splitMs / 1000, elapsedSeconds: (item.elapsedMs ?? item.splitMs) / 1000, averageSpeedMps: 0, paceSecondsPerKm: item.distanceMeters ? item.splitMs / 1000 / (item.distanceMeters / 1000) : null }]);
  return <main className={`story story-${slide}`} onTouchStart={(e) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }} onTouchEnd={(e) => { if (!touch.current || dialog.current?.open) return; const dx=e.changedTouches[0].clientX-touch.current.x,dy=e.changedTouches[0].clientY-touch.current.y;if(Math.abs(dx)>65&&Math.abs(dx)>Math.abs(dy)*1.5)setSlide((s)=>Math.max(0,Math.min(6,s+(dx<0?1:-1))));touch.current=null; }}>
    <header className="story-header"><Link href="/">← Your races</Link><span>{registration.event.name}</span></header>
    <StoryProgress current={slide} count={pages.length} labels={pages} onSelect={setSlide} />
    {stravaFeedback && <p className="strava-callback" role="status">{stravaFeedback.notice}</p>}
    <section className="story-content" key={slide}>
      {slide===0&&<div className="story-scene scene-intro"><p className="scene-label">{registration.event.name}</p><h1 ref={heading} tabIndex={-1}>Hi <span>{firstName}</span>,<br />here goes your <span>Fun Wrapped</span></h1><Image className="decoration decoration-intro-shoe" src={decorationUrl(recapDecorations.intro[0])} width={180} height={180} alt="" /><Image className="decoration decoration-intro-runner" src={decorationUrl(recapDecorations.intro[1])} width={430} height={430} alt="" priority /></div>}
      {slide===1&&<div className="story-scene scene-finisher"><p className="scene-label">Your race</p><h1 ref={heading} tabIndex={-1}><span>{model.source==="strava"?"Recorded activity":model.outcome==="finished"?"Official result":"Race record"}</span></h1><p className="story-intro">{model.source==="strava"?"Your recorded activity, in numbers and photos.":outcomeCopy[model.outcome]}</p><p>{registration.event.category} · BIB {registration.runner.bibNumber??"unassigned"}</p><Image className="decoration decoration-finisher-badge" src={decorationUrl(recapDecorations.finisher[0])} width={360} height={360} alt="" /></div>}
      {slide===2&&<div className="story-scene scene-distance"><p className="scene-label">Distance</p><h2 ref={heading} tabIndex={-1}>Your recorded distance.</h2><div className="distance-number">{(performance.distanceMeters/1000).toFixed(1)}<span>km</span></div><div className="stat-pair"><div><strong>{time}</strong><span>{model.source==="official"?"Official time":"Moving time"}</span></div><div><strong>{pace}</strong>{performance.averagePaceSecondsPerKm!==null&&<span>Average pace</span>}</div>{readySnapshot&&<div><strong>{formatMmSs(readySnapshot.elapsedTimeSeconds)}</strong><span>Elapsed time</span></div>}</div></div>}
      {slide===3&&<div className="story-scene scene-splits"><p className="scene-label">Splits</p><h2 ref={heading} tabIndex={-1}>Race splits</h2>{model.source === "official" ? <OfficialCheckpointList checkpoints={performance.splits} /> : <StravaSplitChart splits={chartSplits} fastestKilometer={readySnapshot?.fastestKilometer??null} paceTrend={readySnapshot?.paceTrend??null} />}</div>}
      {slide===4&&<div className="story-scene scene-context"><p className="scene-label">Race context</p><h2 ref={heading} tabIndex={-1}>{strava && !["disconnected", "no_match", "unavailable", "reauthorize_required", "demo"].includes(strava.state) ? "Your Strava activity" : "Official race context"}</h2>{strava && !["disconnected", "no_match", "unavailable", "reauthorize_required", "demo"].includes(strava.state) ? <StravaCard runnerId={runnerId} input={strava} onRefresh={refresh} onLocalDisconnect={invalidateWrapped} stravaFirst />:<RunnerFeedback kind="empty" title="No Strava activity added."><p>Your official result already powers this Wrapped.</p><Link className="button" href={`/runners/${encodeURIComponent(runnerId)}/strava`} prefetch={false}>Add details from Strava</Link></RunnerFeedback>}</div>}
      {slide === 5 && <div className="story-scene scene-photos">
        <h2 ref={heading} tabIndex={-1}>Caught<br /><span>in the moment.</span></h2>
        {model.photos.length ? <div className="photo-grid">{model.photos.map(photo =>
          <RacePhoto key={`${photo.source}-${photo.id}`} photo={photo} onOpen={() => setSelected(photo)} />)}
        </div> : <RunnerFeedback kind="empty" title="No photos in this recap yet."><p>Your race statistics are still here.</p></RunnerFeedback>}
        <Link className="story-photo-link" href={`/runners/${encodeURIComponent(runnerId)}/photos`} prefetch={false}>Manage my photos</Link>
      </div>}
      {slide===6&&<div className="story-scene scene-share"><p className="scene-label">Share</p><span className="share-year" aria-hidden="true">{registration.event.date.slice(0,4)}</span><SharePreview payload={payload} /><button className="save-button" onClick={save} disabled={saving}>{saving?"Preparing image…":"Save image"}</button><Link className="share-back" href="/">Back to my races</Link><p className="subtle">1080 × 1350 PNG</p></div>}
    </section>
    <StoryControls current={slide} count={pages.length} onPrevious={()=>setSlide((s)=>s-1)} onNext={()=>setSlide((s)=>s+1)} />
    <p className="export-notice" role="status">{notice}</p>{model.source==="strava"&&<p className="strava-attribution">Powered by Strava</p>}
    <dialog ref={dialog} className="photo-dialog" onClose={()=>setSelected(null)} onClick={(e)=>{if(e.target===dialog.current)dialog.current.close();}}><button autoFocus onClick={()=>dialog.current?.close()}>Close photo</button>{selected && <RacePhoto key={`${selected.source}-${selected.id}`} photo={selected} />}</dialog>
  </main>;
}
