"use client";

import Link from "next/link";
import Image from "next/image";
import { useState, type FormEvent } from "react";

export default function Register() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);

      if (body.requiresEmailConfirmation) {
        setAwaitingConfirmation(true);
        setBusy(false);
        return;
      }

      window.location.replace("/");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Account creation failed. Please retry.",
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
      <section className="login-form register-form">
        {awaitingConfirmation ? (
          <div className="register-confirmation" role="status">
            <p className="register-kicker">One last step</p>
            <h2>Check your inbox.</h2>
            <p>
              Use the confirmation link we sent, then come back to find your
              race.
            </p>
            <Link className="auth-primary-link" href="/login">
              Back to login
            </Link>
          </div>
        ) : (
          <form onSubmit={submit}>
            <h2>Create account.</h2>
            <label className="register-field">
              <span>Email</span>
              <input
                name="email"
                type="email"
                autoComplete="email"
                placeholder="Email"
                required
                maxLength={254}
              />
            </label>
            <label className="register-field">
              <span>Password</span>
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                placeholder="Password"
                required
                minLength={8}
                maxLength={1024}
              />
            </label>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button disabled={busy} type="submit">
              {busy ? "Creating account…" : "Create account"}
            </button>
            <div className="auth-divider" aria-hidden="true">
              <span>or</span>
            </div>
            <button
              className="google-auth-button"
              disabled
              title="Google sign-in is not configured for this application."
              type="button"
            >
              <Image
                alt=""
                aria-hidden="true"
                height={20}
                src="/auth/google-g.svg"
                width={20}
              />
              Continue with Google
            </button>
            <p className="auth-switch">
              Already have an account? <Link href="/login">Log in</Link>
            </p>
          </form>
        )}
      </section>
    </main>
  );
}
