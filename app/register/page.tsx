"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useRef, useState, type FormEvent } from "react";

type Match = { bib: string; name: string; distance: "5K" | "10K" };
type Preview = { ticket: string; match: Match };
type Step =
  | { kind: "lookup" }
  | { kind: "review"; preview: Preview }
  | { kind: "accepted"; match: Match }
  | { kind: "done" };

async function send<T>(path: string, body: object, method = "POST"): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) {
    throw new Error(result?.error ?? "This request could not be completed. Please retry.");
  }
  return result;
}

function RegisterForm() {
  const linking = useSearchParams().get("link") === "1";
  const [step, setStep] = useState<Step>({ kind: "lookup" });
  const [eventId, setEventId] = useState("1");
  const [bib, setBib] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lookupVersion = useRef(0);
  const pending = useRef(false);

  function setPending(value: boolean) {
    pending.current = value;
    setBusy(value);
  }

  function updateLookup() {
    lookupVersion.current += 1;
    setPending(false);
    setError("");
  }

  async function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const currentVersion = ++lookupVersion.current;
    setPending(true);
    setError("");
    try {
      const preview = await send<Preview>("/api/auth/bib/lookup", { eventId: Number(eventId), bib });
      if (currentVersion === lookupVersion.current) setStep({ kind: "review", preview });
    } catch (cause) {
      if (currentVersion === lookupVersion.current) {
        setError(cause instanceof Error ? cause.message : "BIB lookup failed. Please retry.");
      }
    } finally {
      if (currentVersion === lookupVersion.current) setPending(false);
    }
  }

  async function run(action: () => Promise<void>) {
    if (pending.current) return;
    setPending(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This request could not be completed. Please retry.");
    } finally {
      setPending(false);
    }
  }

  function accept(preview: Preview) {
    return run(async () => {
      await send("/api/auth/bib/accept", { ticket: preview.ticket });
      setStep({ kind: "accepted", match: preview.match });
    });
  }

  function reject(ticket?: string) {
    return run(async () => {
      await send("/api/auth/bib/accept", { ticket }, "DELETE");
      setStep({ kind: "lookup" });
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    return run(async () => {
      if (linking) {
        await send("/api/auth/bib/link", {});
      } else {
        await send("/api/auth/register", {
          email: form.get("email"),
          password: form.get("password"),
        });
      }
      setStep({ kind: "done" });
    });
  }

  const alert = error && <p className="error" role="alert">{error}</p>;

  if (step.kind === "done") {
    return (
      <div className="register-confirmation" role="status">
        <h2>{linking ? "Your result is linked." : "Check your inbox."}</h2>
        {!linking && <p>Confirm your email, then log in to see your race result.</p>}
        <Link className="auth-primary-link" href={linking ? "/" : "/login"}>
          {linking ? "View my races" : "Back to login"}
        </Link>
      </div>
    );
  }

  if (step.kind === "review") {
    const { preview } = step;
    return (
      <form onSubmit={(event) => { event.preventDefault(); void accept(preview); }}>
        <h2>Confirm your result.</h2>
        <p><strong>{preview.match.name}</strong></p>
        <p>BIB {preview.match.bib} · {preview.match.distance}</p>
        {alert}
        <button disabled={busy} type="submit">{busy ? "Please wait…" : "This is my result"}</button>
        <button className="auth-text-button" disabled={busy} type="button" onClick={() => void reject(preview.ticket)}>
          Use a different BIB
        </button>
      </form>
    );
  }

  if (step.kind === "accepted") {
    return (
      <form onSubmit={submit}>
        <h2>{linking ? "Link your result." : "Create account."}</h2>
        <p>{step.match.name} · BIB {step.match.bib} · {step.match.distance}</p>
        {!linking && (
          <>
            <label className="register-field">
              <span>Demo email (any valid address)</span>
              <input name="email" type="email" autoComplete="email" required maxLength={254} />
            </label>
            <label className="register-field">
              <span>Password</span>
              <input name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={1024} />
            </label>
          </>
        )}
        {alert}
        <button disabled={busy} type="submit">
          {busy ? "Please wait…" : linking ? "Link my result" : "Create account"}
        </button>
        <button className="auth-text-button" disabled={busy} type="button" onClick={() => void reject()}>
          Use a different BIB
        </button>
        {!linking && <p className="auth-switch">Already have an account? <Link href="/login">Log in</Link></p>}
      </form>
    );
  }

  return (
    <form onSubmit={lookup}>
      <h2>Find your race result.</h2>
      <label className="register-field">
        <span>Event edition</span>
        <input name="eventId" type="number" min={1} required value={eventId} onChange={(event) => {
          updateLookup();
          setEventId(event.target.value);
        }} />
      </label>
      <label className="register-field">
        <span>BIB number</span>
        <input name="bib" autoComplete="off" maxLength={40} required value={bib} onChange={(event) => {
          updateLookup();
          setBib(event.target.value);
        }} />
      </label>
      {alert}
      <button disabled={busy} type="submit">{busy ? "Searching…" : "Find my result"}</button>
      {linking
        ? <p className="auth-switch"><Link href="/">Back to my races</Link></p>
        : <p className="auth-switch">Already have an account? <Link href="/login">Log in</Link></p>}
    </form>
  );
}

export default function Register() {
  return (
    <main className="login-layout">
      <section className="login-story">
        <div className="login-story-content">
          <h1>
            <span>Soekarno</span>
            <br />
            <b>Run</b>
          </h1>
          <p>Your race, in numbers, photos and one good memory.</p>
        </div>
      </section>
      <section className="login-form register-form">
        <Suspense fallback={<p role="status">Loading registration…</p>}>
          <RegisterForm />
        </Suspense>
      </section>
    </main>
  );
}
