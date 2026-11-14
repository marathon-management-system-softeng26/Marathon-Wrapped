"use client";
import { useState } from "react";

export type AccessRow = {
  runner_id: string;
  bib_number: string | null;
  name: string;
  category: string;
  linked: boolean;
};

type Issued = { runnerId: string; claimId: string; token: string; expiresAt: string; mailed: boolean };

const expiry = (value: string) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Jakarta" }).format(date)
    : null;
};

/**
 * Organizer view of who has claimed a registration. Claim status is a boolean from the
 * server; the owning account's email and user id are never part of an organizer payload.
 */
export default function OrganizerRunnerAccess({ eventId, rows }: { eventId: string; rows: AccessRow[] }) {
  const [issued, setIssued] = useState<Issued | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const path = (runnerId: string) => `/api/organizer/events/${encodeURIComponent(eventId)}/runners/${encodeURIComponent(runnerId)}/claim`;

  async function create(runnerId: string) {
    setBusy(runnerId);
    setError("");
    setIssued(null);
    try {
      const response = await fetch(path(runnerId), {
        method: "POST", credentials: "same-origin", cache: "no-store",
        signal: AbortSignal.timeout(12000),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Could not create a claim code. Retry.");
      setIssued({ runnerId, claimId: body.id, token: body.token, expiresAt: body.expiresAt, mailed: body.mailed === true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create a claim code. Retry.");
    } finally {
      setBusy("");
    }
  }

  async function revoke(claim: Issued) {
    setBusy(claim.runnerId);
    setError("");
    try {
      const response = await fetch(path(claim.runnerId), {
        method: "DELETE", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimId: claim.claimId }),
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body.error === "string" ? body.error : "Could not revoke the claim code. Retry.");
      }
      setIssued(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not revoke the claim code. Retry.");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="organizer-access" aria-labelledby="organizer-access-heading">
      <h3 id="organizer-access-heading">Runner claims</h3>
      <p>
        Creating a code sends it to the runner&apos;s registered address. The code also appears here once and is not
        stored in a readable form, so issue a new one if it is lost.
      </p>
      {error && <p role="alert">{error}</p>}
      <ul className="organizer-access-list" role="list">
        {rows.map((row) => {
          const claim = issued?.runnerId === row.runner_id ? issued : null;
          const when = claim && expiry(claim.expiresAt);
          return (
            <li key={row.runner_id}>
              <div>
                <strong>{row.name}</strong>
                <span className="organizer-access-details">
                  BIB {row.bib_number ?? "unassigned"} &#183; {row.category} &#183;{" "}
                  <b>{row.linked ? "Claimed" : "Not claimed"}</b>
                </span>
              </div>
              {claim ? (
                <div className="organizer-access-code">
                  <code>{claim.token}</code>
                  <p role="status">
                    {claim.mailed
                      ? "Sent to the registered address."
                      : "Could not send it — give this code to the runner yourself."}
                  </p>
                  <p>Copy this code now — it is shown once{when ? `, and expires ${when} WIB` : ""}.</p>
                  <button type="button" disabled={busy === row.runner_id} onClick={() => void revoke(claim)}>
                    Revoke claim code
                  </button>
                </div>
              ) : (
                <button type="button" disabled={busy === row.runner_id} onClick={() => void create(row.runner_id)}>
                  Create claim code
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
