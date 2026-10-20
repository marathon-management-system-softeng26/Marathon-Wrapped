"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
export default function Login() {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      window.location.replace("/");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Sign in failed. Please retry.",
      );
      setBusy(false);
    }
  }
  return (
    <main className="login-layout">
      <section className="login-story">
        <Link className="wordmark" href="/">
          Marathon
          <br />
          <b>Wrapped.</b>
        </Link>
        <h1>
          The finish line
          <br />
          was just
          <br />
          <span>the beginning.</span>
        </h1>
        <p>Your race, in numbers, photos and one good memory.</p>
      </section>
      <section className="login-form">
        <form onSubmit={submit}>
          <h2>Back to your race.</h2>
          <p>Sign in with the account linked to your registration.</p>
          <label>
            Email
            <input
              name="email"
              type="email"
              autoComplete="username"
              required
              maxLength={254}
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={1024}
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button disabled={busy} type="submit">
            {busy ? "Signing in…" : "Find my race"}
          </button>
          <p className="help">
            Demo access is provided by the organizer. This prototype uses
            synthetic race data.
          </p>
        </form>
      </section>
    </main>
  );
}
