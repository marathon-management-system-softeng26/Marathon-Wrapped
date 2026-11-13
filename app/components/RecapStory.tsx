"use client";
import Link from "next/link";
import SharePreview from "./SharePreview";
import StravaCard from "./StravaCard";
import Arrow from "./Arrow";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { callbackFeedback } from "@/lib/strava/viewModel";
import type { Photo, StravaFirstWrappedPayload, WrappedPayloadStrava } from "@/lib/wrappedPayload";
import { formatMmSs } from "@/lib/format";
import { shareModel } from "@/lib/shareModel";
import { exportWrapped } from "@/lib/exportWrapped";
import { decorationUrl, recapDecorations } from "@/lib/recapDecorations";
const pages = [
  "Intro",
  "Your race",
  "Distance",
  "Splits",
  "Context",
  "Photos",
  "Save",
];
const workflowTitles: Record<Exclude<StravaFirstWrappedPayload["state"], "ready">, string> = {
  setup_required: "Connect Strava to create your Wrapped",
  authorizing: "Waiting for Strava authorization",
  importing: "Finding your race activity",
  needs_confirmation: "Choose your race activity",
  no_match: "No matching race activity found",
  building: "Building your Wrapped",
  failed: "Your Wrapped could not be built",
  reauth_required: "Reconnect your Strava account",
};

const stravaStates: Record<StravaFirstWrappedPayload["state"], WrappedPayloadStrava["state"]> = {
  setup_required: "disconnected",
  authorizing: "authorizing",
  importing: "importing",
  needs_confirmation: "needs_confirmation",
  no_match: "no_match",
  building: "importing",
  ready: "connected",
  failed: "unavailable",
  reauth_required: "reauthorize_required",
};

function RacePhoto({ photo, onOpen }: { photo: Photo; onOpen: () => void }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <p className="photo-error">
      This photo could not load. Reopen the recap to retry.
    </p>
  ) : (
    <button
      className="photo-button"
      onClick={onOpen}
      aria-label="Open race photo"
    >
      <Image
        unoptimized
        width={861}
        height={1148}
        src={photo.photo_url}
        alt="Runners at a race"
        onError={() => setFailed(true)}
      />
      <span>View photo</span>
    </button>
  );
}
export default function RecapStory({ runnerId }: { runnerId: string }) {
  const [payload, setPayload] = useState<StravaFirstWrappedPayload | null>(null),
    [error, setError] = useState(""),
    [version, setVersion] = useState(0),
    [slide, setSlide] = useState(0),
    [notice, setNotice] = useState(""),
    [stravaFeedback, setStravaFeedback] = useState<{ notice: string; path: string } | null>(null),
    [saving, setSaving] = useState(false),
    [selected, setSelected] = useState<Photo | null>(null);
  const heading = useRef<HTMLHeadingElement>(null),
    dialog = useRef<HTMLDialogElement>(null),
    loaded = useRef<string | null>(null),
    wrappedRequest = useRef<AbortController | null>(null),
    exportRequest = useRef<AbortController | null>(null),
    touch = useRef<{ x: number; y: number } | null>(null);
  const strava = useMemo((): WrappedPayloadStrava | null => {
    if (!payload) return null;
    const snapshot = payload.state === "ready" ? payload.snapshot : null;
    return {
      state: stravaStates[payload.state],
      metrics: snapshot ? {
        avg_heartrate: snapshot.averageHeartrate,
        max_heartrate: snapshot.maxHeartrate,
        elevation_gain_m: snapshot.elevationGainMeters,
        calories: snapshot.calories,
        avg_cadence: snapshot.averageCadence,
      } : null,
      candidates: payload.state === "needs_confirmation" ? payload.candidates : undefined,
    };
  }, [payload]);
  const refresh = useCallback(() => setVersion((value) => value + 1), []);
  const invalidateWrapped = useCallback(() => {
    wrappedRequest.current?.abort();
    exportRequest.current?.abort();
    setPayload((current) => current && { state: "setup_required", registration: current.registration });
    setSelected(null);
    setNotice("Strava is disconnected from your Wrapped.");
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
    const controller = new AbortController();
    wrappedRequest.current = controller;
    fetch(`/api/runners/${encodeURIComponent(runnerId)}/wrapped`, {
      cache: "no-store",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]),
    })
      .then(async (response) => {
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          window.location.replace("/login");
          return;
        }
        const body = await response.json();
        if (controller.signal.aborted) return;
        if (response.status === 404) {
          loaded.current = null;
          setPayload(null);
          setError(body.error || "Your recap could not load.");
          return;
        }
        if (!response.ok)
          throw new Error(body.error || "Your recap could not load.");
        loaded.current = runnerId;
        setPayload(body);
        setError("");
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          if (loaded.current === runnerId) setNotice("Recap could not refresh. Try again in a moment.");
          else setError(cause.message);
        }
      });
    return () => controller.abort();
  }, [runnerId, version]);
  useEffect(() => () => exportRequest.current?.abort(), []);
  useEffect(() => {
    if (!payload || !["authorizing", "importing", "building"].includes(payload.state)) return;
    const timer = window.setTimeout(refresh, 5000);
    return () => window.clearTimeout(timer);
  }, [payload, refresh]);
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (
        dialog.current?.open ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        (event.target instanceof HTMLElement &&
          event.target.closest(
            "input,textarea,select,button,a,[contenteditable]",
          ))
      )
        return;
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        setSlide((s) =>
          Math.max(0, Math.min(6, s + (event.key === "ArrowRight" ? 1 : -1))),
        );
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [slide]);
  useEffect(() => {
    if (selected) dialog.current?.showModal();
  }, [selected]);
  async function save() {
    if (payload?.state !== "ready") return;
    const controller = new AbortController();
    exportRequest.current = controller;
    setSaving(true);
    setNotice("");
    try {
      await exportWrapped(payload, controller.signal);
      setNotice("PNG ready. Check your browser downloads.");
    } catch (cause) {
      if (controller.signal.aborted) return;
      setNotice(
        cause instanceof Error
          ? cause.message
          : "Image could not be saved. Please retry.",
      );
    } finally {
      exportRequest.current = null;
      setSaving(false);
    }
  }
  if (error || !payload)
    return (
      <main className="story-state">
        <Link href="/">← Your races</Link>
        <h1>{error ? "Your recap needs a moment." : "Finding your race…"}</h1>
        {error && (
          <>
            <p role="alert">{error}</p>
            <button onClick={() => setVersion((v) => v + 1)}>Try again</button>
          </>
        )}
      </main>
    );
  if (payload.state !== "ready") {
    const { runner, event } = payload.registration;
    return (
      <main className="story-state">
        <Link href="/">&#8592; Your races</Link>
        <h1>{workflowTitles[payload.state]}</h1>
        <p>{runner.name} &#183; {event.name} &#183; {event.category}</p>
        {payload.state === "failed" ? (
          <p role="status">A Wrapped recap is unavailable for this registration.</p>
        ) : (
          <>
            {stravaFeedback && <p role="status">{stravaFeedback.notice}</p>}
            {strava && <StravaCard runnerId={runnerId} input={strava} onRefresh={refresh} onLocalDisconnect={invalidateWrapped} stravaFirst />}
            {notice && <p role="status">{notice}</p>}
          </>
        )}
      </main>
    );
  }
  const model = shareModel(payload),
    snapshot = payload.snapshot,
    longestSplit = Math.max(1, ...snapshot.splits.map((split) => split.movingSeconds)),
    firstName = model.name.trim().split(/\s+/)[0] || "Runner";
  return (
    <main
      className={`story story-${slide}`}
      onTouchStart={(event) => {
        touch.current = {
          x: event.touches[0].clientX,
          y: event.touches[0].clientY,
        };
      }}
      onTouchEnd={(event) => {
        if (!touch.current || dialog.current?.open) return;
        const dx = event.changedTouches[0].clientX - touch.current.x,
          dy = event.changedTouches[0].clientY - touch.current.y;
        if (Math.abs(dx) > 65 && Math.abs(dx) > Math.abs(dy) * 1.5)
          setSlide((s) => Math.max(0, Math.min(6, s + (dx < 0 ? 1 : -1))));
        touch.current = null;
      }}
    >
      <header className="story-header">
        <Link href="/">← Your races</Link>
        <span>{model.event}</span>
      </header>
      <nav className="story-tabs" aria-label="Recap pages">
        {pages.map((page, index) => (
          <button
            key={page}
            aria-current={slide === index ? "step" : undefined}
            onClick={() => setSlide(index)}
          >
            <span className={index <= slide ? "filled" : ""} />
            <small>{page}</small>
          </button>
        ))}
      </nav>
      {stravaFeedback && <p className="strava-callback" role="status">{stravaFeedback.notice}</p>}
      <section className="story-content" key={slide}>
        {slide === 0 && (
          <div className="story-scene scene-intro">
            <p className="scene-label">{model.event}</p>
            <h1 ref={heading} tabIndex={-1}>
              Hi <span>{firstName}</span>,<br />
              here goes your <span>Fun Wrapped</span>
            </h1>
            <Image
              className="decoration decoration-intro-shoe"
              src={decorationUrl(recapDecorations.intro[0])}
              width={180}
              height={180}
              alt=""
            />
            <Image
              className="decoration decoration-intro-runner"
              src={decorationUrl(recapDecorations.intro[1])}
              width={430}
              height={430}
              alt=""
              priority
            />
          </div>
        )}
        {slide === 1 && (
          <div className="story-scene scene-finisher">
            <p className="scene-label">{model.event}</p>
            <h1 ref={heading} tabIndex={-1}>
              <span>Your race</span>
              <br />
              on Strava.
            </h1>
            <p className="story-intro">
              Your recorded activity, in numbers and photos.
            </p>
            <Image
              className="decoration decoration-finisher-badge"
              src={decorationUrl(recapDecorations.finisher[0])}
              width={360}
              height={360}
              alt=""
            />
          </div>
        )}
        {slide === 2 && (
          <div className="story-scene scene-distance">
            <p className="scene-label">Distance</p>
            <h2 ref={heading} tabIndex={-1}>
              Your recorded distance.
            </h2>
            <div className="distance-number">
              {(snapshot.distanceMeters / 1000).toFixed(1)}
              <span>km</span>
            </div>
            <div className="stat-pair">
              <div>
                <strong>{model.time}</strong>
                <span>Moving time</span>
              </div>
              <div>
                <strong>{model.pace}</strong>
                {snapshot.averagePaceSecondsPerKm !== null && <span>Average pace</span>}
              </div>
            </div>
            <Image
              className="decoration decoration-distance-medal"
              src={decorationUrl(recapDecorations.distance[0])}
              width={190}
              height={190}
              alt=""
            />
            <Image
              className="decoration decoration-distance-runner"
              src={decorationUrl(recapDecorations.distance[1])}
              width={270}
              height={270}
              alt=""
            />
          </div>
        )}
        {slide === 3 && (
          <div className="story-scene scene-splits">
            <p className="scene-label">Splits</p>
            <h2 ref={heading} tabIndex={-1}>
              Kilometer splits
            </h2>
            {snapshot.splits.length ? (
              <>
                <div
                  className="split-chart"
                  role="img"
                  aria-label="Kilometer moving times. Taller bars indicate longer times."
                >
                  {snapshot.splits.map((split) => (
                    <div key={split.kilometer}>
                      <span
                        style={{
                          height: `${Math.max(20, (split.movingSeconds / longestSplit) * 145)}px`,
                        }}
                        className={split.kilometer === snapshot.fastestKilometer?.kilometer ? "fast" : ""}
                      />
                      <b>{split.kilometer}</b>
                      <small>{formatMmSs(split.movingSeconds)}</small>
                    </div>
                  ))}
                </div>
                {snapshot.fastestKilometer && (
                  <p className="lime">
                    Fastest kilometer {snapshot.fastestKilometer.kilometer} &#183; {formatMmSs(snapshot.fastestKilometer.paceSecondsPerKm)} /km
                  </p>
                )}
              </>
            ) : (
              <p>No kilometer splits available.</p>
            )}
            <Image
              className="decoration decoration-splits-watch"
              src={decorationUrl(recapDecorations.splits[0])}
              width={215}
              height={215}
              alt=""
            />
          </div>
        )}
        {slide === 4 && (
          <div className="story-scene scene-context">
            <p className="scene-label">Race context</p>
            <h2 ref={heading} tabIndex={-1}>
              Your Strava activity
            </h2>
            {strava && <StravaCard runnerId={runnerId} input={strava} onRefresh={refresh} onLocalDisconnect={invalidateWrapped} stravaFirst />}
            <Image
              className="decoration decoration-context-watch"
              src={decorationUrl(recapDecorations.context[0])}
              width={190}
              height={190}
              alt=""
            />
            <Image
              className="decoration decoration-context-card"
              src={decorationUrl(recapDecorations.context[1])}
              width={230}
              height={230}
              alt=""
            />
          </div>
        )}
        {slide === 5 && (
          <div className="story-scene scene-photos">
            <h2 ref={heading} tabIndex={-1}>
              Caught
              <br />
              <span>in the moment.</span>
            </h2>
            {payload.photos.length ? (
              <>
                <div className="photo-grid">
                  {payload.photos.map((photo) => (
                    <RacePhoto
                      key={photo.id}
                      photo={photo}
                      onOpen={() => setSelected(photo)}
                    />
                  ))}
                </div>
                <p className="subtle">
                  {payload.photos.length}{" "}
                  {payload.photos.length === 1 ? "photo" : "photos"} mapped to
                  BIB {model.bib}.
                </p>
              </>
            ) : (
              <p>
                No photos are available for this BIB yet. Your race statistics
                are still here.
              </p>
            )}
            <Image
              className="decoration decoration-photos-glasses"
              src={decorationUrl(recapDecorations.photos[0])}
              width={180}
              height={180}
              alt=""
            />
          </div>
        )}
        {slide === 6 && (
          <div className="story-scene scene-share">
            <p className="scene-label">Share</p>
            <span className="share-year" aria-hidden="true">
              {model.year}
            </span>
            <SharePreview payload={payload} />
            <button className="save-button" onClick={save} disabled={saving}>
              {saving ? "Preparing image…" : "Save image"}
            </button>
            <Link className="share-back" href="/">
              Back to my races
            </Link>
            <p className="subtle">
              1080 &#215; 1350 PNG
            </p>
            <Image
              className="decoration decoration-share-finish"
              src={decorationUrl(recapDecorations.share[0])}
              width={220}
              height={220}
              alt=""
            />
          </div>
        )}
      </section>
      <footer className="story-controls">
        <button
          className="circle"
          aria-label="Previous page"
          onClick={() => setSlide((s) => s - 1)}
          disabled={slide === 0}
        >
          <Arrow left />
        </button>
        <span>
          {slide + 1} / {pages.length}
        </span>
        <button
          className="circle"
          aria-label="Next page"
          onClick={() => setSlide((s) => s + 1)}
          disabled={slide === 6}
        >
          <Arrow />
        </button>
      </footer>
      <p className="export-notice" role="status">
        {notice}
      </p>
      <dialog
        ref={dialog}
        className="photo-dialog"
        onClose={() => setSelected(null)}
        onClick={(event) => {
          if (event.target === dialog.current) dialog.current.close();
        }}
      >
        <button autoFocus onClick={() => dialog.current?.close()}>
          Close photo
        </button>
        {selected && (
          <>
            <Image
              unoptimized
              width={861}
              height={1148}
              src={selected.photo_url}
              alt="Runners at a race"
            />
            {selected.photographer && <p>{selected.photographer}</p>}
          </>
        )}
      </dialog>
    </main>
  );
}
