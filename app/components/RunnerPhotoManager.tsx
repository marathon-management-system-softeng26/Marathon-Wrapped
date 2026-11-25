"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import AppHeader from "./AppHeader";
import { createSupabaseBrowser } from "@/lib/supabaseBrowser";
import { PHOTO_MIME_TYPES, type RunnerPhotoSlot, type RunnerPhotoUploadCapability } from "@/lib/runnerPhotos/types";
import { parseUploadDeclaration } from "@/lib/runnerPhotos/validation";

type Position = { photo: RunnerPhotoSlot | null; progress: string; error: string; preview: string | null };
type Action =
  | { kind: "upload"; file: File }
  | { kind: "include" | "complete" | "delete"; photo: RunnerPhotoSlot };

function emptyPosition(): Position {
  return { photo: null, progress: "", error: "", preview: null };
}

// Keep known photos in their positions when another photo is added or removed.
function reconcile(current: Position[], photos: RunnerPhotoSlot[]): Position[] {
  const incoming = new Map(photos.map(photo => [photo.id, photo]));
  const positions = current.map(position => {
    if (!position.photo) return position;
    const photo = incoming.get(position.photo.id);
    if (!photo) return emptyPosition();
    incoming.delete(photo.id);
    return { ...position, photo };
  });
  const newPhotos = incoming.values();
  return positions.map(position => {
    if (position.photo) return position;
    const photo = newPhotos.next().value;
    return photo ? { ...emptyPosition(), photo } : position;
  });
}

async function request(path: string, signal: AbortSignal, method = "GET", body?: object) {
  signal.throwIfAborted();
  const response = await fetch(path, {
    cache: "no-store", signal, method,
    ...(body && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  signal.throwIfAborted();
  if (response.status === 401) window.location.replace("/login");
  return response;
}

async function write(path: string, signal: AbortSignal, method: string, body: object = {}) {
  const response = await request(path, signal, method, body);
  if (!response.ok) throw new Error();
  return response;
}

export default function RunnerPhotoManager({ runnerId }: { runnerId: string }) {
  return <PhotoSheet key={runnerId} collection={`/api/runners/${encodeURIComponent(runnerId)}/photos`} />;
}

function PhotoSheet({ collection }: { collection: string }) {
  const [slots, setSlots] = useState(() => Array.from({ length: 3 }, emptyPosition));
  const [loaded, setLoaded] = useState(false);
  const [listError, setListError] = useState("");
  const controller = useRef<AbortController | null>(null);
  // A slot lock also owns its temporary preview, including during unmount.
  const active = useRef(new Map<number, string | null>());
  const revision = useRef(0);
  const needsList = useRef(false);

  const reload = useCallback(async (signal: AbortSignal) => {
    needsList.current = true;
    if (active.current.size > 0) return;
    const version = ++revision.current;
    try {
      const response = await request(collection, signal);
      if (response.status === 404 && version === revision.current) {
        setLoaded(false);
        setSlots(Array.from({ length: 3 }, emptyPosition));
      }
      if (!response.ok) throw new Error();
      const { photos }: { photos: RunnerPhotoSlot[] } = await response.json();
      if (signal.aborted || version !== revision.current) return;
      setSlots(current => reconcile(current, photos));
      setLoaded(true);
      setListError("");
    } catch {
      if (!signal.aborted && version === revision.current) setListError("Your photos could not load. Try again.");
    } finally {
      if (version === revision.current) needsList.current = false;
    }
  }, [collection]);

  useEffect(() => {
    const session = new AbortController();
    controller.current = session;
    const operations = active.current;
    queueMicrotask(() => { if (!session.signal.aborted) void reload(session.signal); });
    return () => {
      session.abort();
      for (const preview of operations.values()) if (preview) URL.revokeObjectURL(preview);
      operations.clear();
    };
  }, [reload]);

  function update(index: number, changes: Partial<Position>) {
    setSlots(current => current.map((position, at) => at === index ? { ...position, ...changes } : position));
  }

  async function run(index: number, action: Action) {
    const signal = controller.current?.signal;
    if (!signal || signal.aborted || active.current.has(index)) return;
    active.current.set(index, null);
    revision.current++;
    // The picker, retry and delete buttons can disappear while their request runs.
    const heading = document.getElementById(`photo-position-${index + 1}`);
    if (action.kind !== "include" && heading?.parentElement?.contains(document.activeElement)) {
      heading.focus({ preventScroll: true });
    }
    let failure = "The photo could not be updated. Try again.";
    let refresh = false;
    try {
      if (action.kind === "upload") {
        const { file } = action;
        failure = "Choose a JPEG, PNG or WebP between 1 byte and 5 MiB.";
        const declaration = parseUploadDeclaration({ mimeType: file.type, sizeBytes: file.size });
        failure = "The upload could not start. Check your connection and try again.";
        const preview = URL.createObjectURL(file);
        active.current.set(index, preview);
        update(index, { preview, progress: "Starting upload…", error: "" });
        refresh = true;
        const reservation = await write(collection, signal, "POST", declaration);
        const { photoId, path, token, expiresAt }: RunnerPhotoUploadCapability = await reservation.json();
        signal.throwIfAborted();
        update(index, {
          photo: { id: photoId, state: "pending", included: true, createdAt: new Date().toISOString(), expiresAt, contentUrl: null },
          progress: "Uploading photo…",
        });
        failure = "The upload was interrupted. Retry completion if the file arrived, or cancel and choose the file again.";
        const { error } = await createSupabaseBrowser().storage.from("runner-photos")
          .uploadToSignedUrl(path, token, file, { contentType: file.type });
        signal.throwIfAborted();
        if (error) throw new Error();
        failure = "The photo could not finish processing. Retry completion or cancel and choose another photo.";
        update(index, { progress: "Finishing upload…" });
        const response = await write(`${collection}/${encodeURIComponent(photoId)}/complete`, signal, "POST");
        const photo: RunnerPhotoSlot = await response.json();
        if (!signal.aborted) update(index, { photo });
      } else {
        const { photo } = action;
        const item = `${collection}/${encodeURIComponent(photo.id)}`;
        if (action.kind === "include") {
          const included = !photo.included;
          update(index, { photo: { ...photo, included }, progress: "Saving selection…", error: "" });
          const response = await write(item, signal, "PATCH", { included });
          const saved: RunnerPhotoSlot = await response.json();
          if (!signal.aborted) update(index, { photo: saved });
        } else if (action.kind === "delete") {
          refresh = true;
          update(index, { progress: photo.state === "ready" ? "Deleting photo…" : "Cancelling upload…", error: "" });
          await write(item, signal, "DELETE");
          if (!signal.aborted) update(index, { photo: null });
        } else {
          refresh = true;
          failure = "The photo could not finish processing. Retry completion or cancel and choose another photo.";
          update(index, { progress: "Checking completion…", error: "" });
          const response = await write(item + "/complete", signal, "POST");
          const saved: RunnerPhotoSlot = await response.json();
          if (!signal.aborted) update(index, { photo: saved });
        }
      }
    } catch {
      if (!signal.aborted) update(index, action.kind === "include"
        ? { error: failure, photo: action.photo } : { error: failure });
    } finally {
      if (!signal.aborted) {
        const preview = active.current.get(index);
        if (preview) URL.revokeObjectURL(preview);
        active.current.delete(index);
        update(index, { progress: "", preview: null });
        // A late list response must never replace another slot's optimistic edit.
        if (refresh || needsList.current) void reload(signal);
      }
    }
  }

  return (
    <div className="workspace">
      <AppHeader />
      <main className="content runner-photo-manager">
        <h1 className="page-title">Your race photos</h1>
        <p className="photo-intro">Add up to three photos from this race. Choose which ones to include in your Wrapped.</p>
        <p id="photo-formats">JPEG, PNG or WebP · Up to 5 MiB each</p>
        {listError && <div className="dashboard-error"><p role="alert">{listError}</p>
          <button type="button" onClick={() => { if (controller.current) void reload(controller.current.signal); }}>Try again</button>
        </div>}
        {!loaded && !listError && <p role="status">Loading your race photos…</p>}
        {loaded && <ol className="photo-sheet" aria-label="Race photo slots">
          {slots.map(({ photo, progress, error, preview }, index) => {
            const number = index + 1;
            const heading = `photo-position-${number}`;
            const ready = photo?.state === "ready";
            const image = preview || (ready ? `${collection}/${encodeURIComponent(photo.id)}/content` : null);
            const state = ready ? "Ready" : photo?.state === "pending" ? "Pending upload" : photo ? "Finalizing" : "Empty slot";
            return <li key={index}>
              <section aria-labelledby={heading}>
                <h2 id={heading} tabIndex={-1}>Photo {number}</h2>
                <div className="photo-frame">
                  {image ? <Image unoptimized src={image} width={680} height={510} loading={index === 0 ? "eager" : "lazy"} alt={`Your race photo ${number}`} />
                    : <span aria-hidden="true">{state}</span>}
                </div>
                <p className={progress || ready ? "photo-state" : "sr-only"} role="status">{progress || state}</p>
                {photo?.expiresAt && <p className="photo-expiry">Upload expires <time dateTime={photo.expiresAt}>{new Date(photo.expiresAt).toLocaleString()}</time>.</p>}
                <div className="photo-actions">
                  {!photo && <label className="photo-picker">
                    Choose photo<span className="sr-only"> for slot {number}</span>
                    <input type="file" accept={PHOTO_MIME_TYPES.join(",")} disabled={!!progress} aria-describedby="photo-formats"
                      onChange={event => {
                        const file = event.currentTarget.files?.[0];
                        event.currentTarget.value = "";
                        if (file) void run(index, { kind: "upload", file });
                      }} />
                  </label>}
                  {photo && (ready ? <label className="photo-include">
                    <input type="checkbox" checked={photo.included} disabled={!!progress}
                      onChange={() => void run(index, { kind: "include", photo })} /> Include in Wrapped
                  </label> : <button type="button" className="secondary" disabled={!!progress}
                    onClick={() => void run(index, { kind: "complete", photo })}>Retry completion</button>)}
                  {photo && <button type="button" className="quiet" disabled={!!progress}
                    onClick={() => void run(index, { kind: "delete", photo })}>{ready ? "Delete" : "Cancel"}</button>}
                </div>
                {error && <p className="photo-issue" role="alert">{error}</p>}
              </section>
            </li>;
          })}
        </ol>}
      </main>
    </div>
  );
}
