"use client";
import Link from "next/link";
import SharePreview from "./SharePreview";
import Arrow from "./Arrow";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { WrappedPayload, Photo } from "@/lib/wrappedPayload";
import { formatMmSs } from "@/lib/format";
import { shareModel } from "@/lib/shareModel";
import { exportWrapped } from "@/lib/exportWrapped";
const pages = ["Your race", "Distance", "Splits", "Strava", "Photos", "Save"];
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
        alt="Runners at a race — stock demo photo"
        onError={() => setFailed(true)}
      />
      <span>View photo</span>
    </button>
  );
}
export default function RecapStory({ runnerId }: { runnerId: string }) {
  const [payload, setPayload] = useState<WrappedPayload | null>(null),
    [error, setError] = useState(""),
    [version, setVersion] = useState(0),
    [slide, setSlide] = useState(0),
    [notice, setNotice] = useState(""),
    [saving, setSaving] = useState(false),
    [selected, setSelected] = useState<Photo | null>(null);
  const heading = useRef<HTMLHeadingElement>(null),
    dialog = useRef<HTMLDialogElement>(null),
    touch = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/runners/${encodeURIComponent(runnerId)}/wrapped`, {
      cache: "no-store",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]),
    })
      .then(async (response) => {
        if (response.status === 401) {
          window.location.replace("/login");
          return;
        }
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error || "Your recap could not load.");
        setPayload(body);
        setError("");
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause.message);
      });
    return () => controller.abort();
  }, [runnerId, version]);
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
          Math.max(0, Math.min(5, s + (event.key === "ArrowRight" ? 1 : -1))),
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
    if (!payload) return;
    setSaving(true);
    setNotice("");
    try {
      await exportWrapped(payload);
      setNotice("PNG ready. Check your browser downloads.");
    } catch (cause) {
      setNotice(
        cause instanceof Error
          ? cause.message
          : "Image could not be saved. Please retry.",
      );
    } finally {
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
  const model = shareModel(payload),
    stats = payload.status === "unavailable" ? null : payload.stats;
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
          setSlide((s) => Math.max(0, Math.min(5, s + (dx < 0 ? 1 : -1))));
        touch.current = null;
      }}
    >
      <header className="story-header">
        <Link href="/">← Your races</Link>
        <span>{model.event} · Demo</span>
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
      <section className="story-content" key={slide}>
        {slide === 0 && (
          <>
            <h1 ref={heading} tabIndex={-1}>
              <span>
                {payload.status === "finisher"
                  ? "You ran"
                  : payload.status === "dnf"
                    ? "You showed up."
                    : "Your race,"}
              </span>
              <br />
              {payload.status === "finisher" ? (
                <>
                  the whole
                  <br />
                  thing.
                </>
              ) : payload.status === "dnf" ? (
                "Every kilometer counts."
              ) : (
                "your story."
              )}
            </h1>
            <p className="story-intro">
              {model.name}, this is your race in numbers, photos and memories.
            </p>
            <p className="subtle">
              BIB {model.bib ?? "unassigned"} · {model.result}
            </p>
          </>
        )}
        {slide === 1 && (
          <>
            <h2 ref={heading} tabIndex={-1}>
              {payload.status === "finisher" ? "All the way." : model.result}
            </h2>
            <div className="distance-number">
              {stats?.distance_km.toFixed(1) ?? "—"}
              <span>km {payload.status !== "finisher" ? "category" : ""}</span>
            </div>
            <div className="stat-pair">
              <div>
                <strong>{model.time}</strong>
                <span>Finish time</span>
              </div>
              <div>
                <strong>{model.pace}</strong>
                <span>Average pace</span>
              </div>
            </div>
            {payload.status === "finisher" ? (
              <p className="lime">
                {model.rank} · Overall in {stats?.category}:{" "}
                {stats?.overall_rank ?? "unavailable"}
              </p>
            ) : (
              <p>
                {payload.status === "unavailable"
                  ? "No chip result has been published. Ask the organizer to check your record."
                  : payload.status === "dns"
                    ? "No start was recorded. Finish statistics are unavailable."
                    : "Your recorded splits are preserved. No finish time or placing is assigned."}
              </p>
            )}
            {stats?.start_status === "late" && (
              <p className="subtle">
                Late start recorded · Timing uses your actual chip start.
              </p>
            )}
          </>
        )}
        {slide === 2 && (
          <>
            <h2 ref={heading} tabIndex={-1}>
              {stats?.split_type === "negative" ? (
                <>
                  You saved your
                  <br />
                  best for last.
                </>
              ) : (
                "Every kilometer, recorded."
              )}
            </h2>
            {stats?.splits.length ? (
              <>
                <div
                  className="split-chart"
                  role="img"
                  aria-label="Kilometer split times; taller bars indicate longer times"
                >
                  {stats.splits.map((split) => (
                    <div key={split.km_marker}>
                      <span
                        style={{
                          height: `${Math.max(20, (split.split_seconds / Math.max(...stats.splits.map((s) => s.split_seconds))) * 145)}px`,
                        }}
                        className={
                          split.km_marker === stats.fastest_km?.km_marker
                            ? "fast"
                            : ""
                        }
                      />
                      <b>{split.km_marker}</b>
                      <small>{formatMmSs(split.split_seconds)}</small>
                    </div>
                  ))}
                </div>
                <p className="lime">
                  Fastest: km {stats.fastest_km?.km_marker} at{" "}
                  {stats.fastest_km
                    ? formatMmSs(stats.fastest_km.split_seconds)
                    : "—"}
                </p>
                <div className="insights">
                  {stats.insights.map((insight) => (
                    <p key={insight}>{insight}</p>
                  ))}
                </div>
              </>
            ) : (
              <p>No kilometer splits were recorded for this result.</p>
            )}
          </>
        )}
        {slide === 3 && (
          <>
            <h2 ref={heading} tabIndex={-1}>
              Your race.
              <br />
              <span>A little more context.</span>
            </h2>
            <div className="enrichment">
              <h3>Strava is not connected</h3>
              <p>
                Connection is not available in this demo yet. Your chip result,
                splits and photos work independently.
              </p>
              {payload.status !== "unavailable" &&
                payload.strava.state === "demo" &&
                payload.strava.metrics && (
                  <>
                    <p className="demo-note">
                      Seeded sample metrics · Not a live Strava activity
                    </p>
                    <dl className="metric-list">
                      {Object.entries(payload.strava.metrics)
                        .filter(([, value]) => value !== null)
                        .map(([key, value]) => (
                          <div key={key}>
                            <dt>
                              {
                                {
                                  avg_heartrate: "Average heart rate (bpm)",
                                  max_heartrate: "Maximum heart rate (bpm)",
                                  elevation_gain_m: "Elevation gain (m)",
                                  calories: "Calories (kcal)",
                                  avg_cadence: "Average cadence (spm)",
                                }[key]
                              }
                            </dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                    </dl>
                  </>
                )}
            </div>
          </>
        )}
        {slide === 4 && (
          <>
            <h2 ref={heading} tabIndex={-1}>
              Caught
              <br />
              <span>in the moment.</span>
            </h2>
            {payload.status !== "unavailable" && payload.photos.length ? (
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
                  BIB {model.bib}. Demo stock image; not an actual match to this
                  runner.
                </p>
              </>
            ) : (
              <p>
                No photos are available for this BIB yet. Your race statistics
                are still here.
              </p>
            )}
          </>
        )}
        {slide === 5 && (
          <>
            <h2 ref={heading} tabIndex={-1}>
              Keep the feeling.
            </h2>
            <SharePreview payload={payload} />
            <button className="save-button" onClick={save} disabled={saving}>
              {saving ? "Preparing image…" : "Save my recap as PNG"}
            </button>
            <p className="subtle">
              1080 × 1350 · Includes synthetic race data. Health metrics stay
              out of your image.
            </p>
          </>
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
          disabled={slide === 5}
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
              alt="Stock demo image of runners at a race"
            />
            <p>{selected.photographer}. Simulated BIB mapping.</p>
          </>
        )}
      </dialog>
    </main>
  );
}
