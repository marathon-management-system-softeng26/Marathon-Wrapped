"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
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
        <div className="login-story-content">
          <h1>
            <span>Soekarno</span>
            <br />
            <b>Run</b>
            <br />
            2027
          </h1>
          <p>Your race, in numbers, photos and one good memory.</p>
        </div>
      </section>
      <section className="login-form">
        <form onSubmit={submit}>
          <h2>Back to your race.</h2>
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
          <button
            className="auth-text-button"
            disabled
            title="Password recovery is not configured yet."
            type="button"
          >
            Forgot Password?
          </button>
          <p className="auth-switch">
            New here? <Link href="/register">Create account</Link>
          </p>
        </form>
      </section>
    </main>
  );
}
