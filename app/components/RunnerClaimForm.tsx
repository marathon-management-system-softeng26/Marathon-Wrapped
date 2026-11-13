import { useId, useRef, useState, type FormEvent } from "react";

export default function RunnerClaimForm({ onClaimed }: { onClaimed: () => void }) {
  const inputId = useId();
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const submitting = useRef(false);

  async function claim(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const token = code.trim();
    setNotice("");
    setError("");
    if (!token) {
      setError("Enter the claim code from your race organizer.");
      return;
    }

    submitting.current = true;
    setPending(true);
    try {
      const response = await fetch("/api/claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
        signal: AbortSignal.timeout(12000),
      });
      if (response.ok) {
        setCode("");
        setNotice("Registration claimed.");
        onClaimed();
      } else if (response.status === 400) {
        setError("This claim is invalid or no longer available.");
      } else if (response.status === 401) {
        setError("Sign in again to claim your registration.");
      } else {
        setError("Could not claim your registration. Try again.");
      }
    } catch {
      setError("Could not claim your registration. Try again.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <form className="runner-claim" onSubmit={claim} method="post" aria-busy={pending} aria-labelledby={`${inputId}-heading`}>
      <h2 id={`${inputId}-heading`}>Claim a race registration</h2>
      <p id={`${inputId}-hint`}>Enter the code from your race organizer.</p>
      <div className="runner-claim-fields">
        <label htmlFor={inputId}>
          Claim code
          <input
            id={inputId}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            required
            maxLength={128}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            readOnly={pending}
            aria-describedby={`${inputId}-hint`}
          />
        </label>
        <button type="submit" disabled={pending}>Claim my registration</button>
      </div>
      <p role="status">{pending ? "Claiming registration…" : notice}</p>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
