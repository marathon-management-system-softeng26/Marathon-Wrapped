"use client";
import { useEffect, useId, useState, type FormEvent } from "react";
import AppHeader from "./AppHeader";
import { useCatalog } from "./useCatalog";
import RunnerFeedback from "./RunnerFeedback";

/**
 * The runner's own account surface: the name they choose for themselves, and the BIBs they hold.
 *
 * The display name is account-level and never touches the organizer's registration record, which
 * supplies the name on a recap. Registrations come from the session catalog, so this screen and
 * the races dashboard cannot disagree about what the account holds.
 */
export default function RunnerProfile() {
  const { data, error: catalogError, retry } = useCatalog();
  const nameId = useId();
  const bibId = useId();
  const [name, setName] = useState("");
  const [email, setEmail] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameNotice, setNameNotice] = useState("");
  const [nameError, setNameError] = useState("");
  const [bib, setBib] = useState("");
  const [addingBib, setAddingBib] = useState(false);
  const [bibNotice, setBibNotice] = useState("");
  const [bibError, setBibError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/profile", {
      cache: "no-store",
      credentials: "same-origin",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]),
    })
      .then(async (response) => {
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          window.location.replace("/login");
          return;
        }
        const body = await response.json().catch(() => ({}));
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "");
        setName(body.display_name ?? "");
        setEmail(body.email ?? null);
        setLoaded(true);
        setProfileError("");
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setProfileError(
            cause instanceof Error && cause.message
              ? cause.message
              : "Your profile is temporarily unavailable.",
          );
        }
      });
    return () => controller.abort();
  }, []);

  async function saveName(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    if (savingName) return;
    setSavingName(true);
    setNameNotice("");
    setNameError("");
    try {
      const response = await fetch("/api/profile", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: name }),
        signal: AbortSignal.timeout(12000),
      });
      if (response.status === 401) {
        window.location.replace("/login");
        return;
      }
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "");
      setName(body.display_name ?? name);
      setNameNotice("Name saved.");
    } catch (cause) {
      setNameError(
        cause instanceof Error && cause.message
          ? cause.message
          : "Your name could not be saved. Try again.",
      );
    } finally {
      setSavingName(false);
    }
  }

  async function addBib(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    if (addingBib) return;
    setAddingBib(true);
    setBibNotice("");
    setBibError("");
    try {
      const response = await fetch("/api/registrations/bib", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bib_number: bib.trim() }),
        signal: AbortSignal.timeout(12000),
      });
      if (response.status === 401) {
        window.location.replace("/login");
        return;
      }
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "");
      setBib("");
      setBibNotice(
        body.status === "already_yours"
          ? "You already hold that BIB."
          : "BIB added. It is in your races now.",
      );
      // The dashboard and this page read the same catalog, so reload it rather than guessing.
      retry();
    } catch (cause) {
      setBibError(
        cause instanceof Error && cause.message
          ? cause.message
          : "That BIB could not be added. Try again.",
      );
    } finally {
      setAddingBib(false);
    }
  }

  return (
    <div className="workspace">
      <AppHeader showOrganizerLink={!!data?.events.length} />
      <main className="content runner-dashboard">
        <h1 className="page-title">
          Your <span>profile.</span>
        </h1>
        <p className="page-subtitle">
          Choose how your name appears here, and add the BIBs you ran.
        </p>

        <section className="profile-panel" aria-labelledby={`${nameId}-heading`}>
          <h2 id={`${nameId}-heading`}>You</h2>
          {profileError && <RunnerFeedback kind="error" title={profileError} />}
          <form onSubmit={saveName} aria-busy={savingName}>
            <label htmlFor={nameId}>
              Display name
              <input
                id={nameId}
                maxLength={120}
                autoComplete="name"
                required
                value={name}
                readOnly={!loaded || savingName}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <p className="profile-email">Signed in as {email ?? "this account"}</p>
            <div className="profile-actions">
              <button type="submit" disabled={!loaded || savingName}>
                {savingName ? "Saving…" : "Save name"}
              </button>
            </div>
            {nameNotice && <RunnerFeedback kind="status" title={nameNotice} />}
            {nameError && <RunnerFeedback kind="error" title={nameError} />}
          </form>
        </section>

        <section className="profile-panel" aria-labelledby={`${bibId}-heading`}>
          <h2 id={`${bibId}-heading`}>Add a BIB</h2>
          <p id={`${bibId}-hint`}>
            Enter the BIB number from your race pack. Only a registration that
            nobody has claimed yet can be added, and repeated misses are limited
            to a few tries.
          </p>
          <form onSubmit={addBib} aria-busy={addingBib}>
            <div className="profile-field-row">
              <label htmlFor={bibId}>
                BIB number
                <input
                  id={bibId}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  required
                  pattern="[A-Za-z0-9-]+"
                  maxLength={40}
                  value={bib}
                  readOnly={addingBib}
                  aria-describedby={`${bibId}-hint`}
                  onChange={(e) => setBib(e.target.value)}
                />
              </label>
              <button type="submit" disabled={addingBib}>
                {addingBib ? "Adding…" : "Add BIB"}
              </button>
            </div>
            {bibNotice && <RunnerFeedback kind="status" title={bibNotice} />}
            {bibError && <RunnerFeedback kind="error" title={bibError} />}
          </form>
        </section>

        <section className="runner-registrations" aria-labelledby="profile-bibs-heading">
          <h2 id="profile-bibs-heading">Your BIBs</h2>
          {catalogError && (
            <div className="dashboard-error">
              <RunnerFeedback kind="error" title={catalogError} />
              <button type="button" onClick={retry}>Try again</button>
            </div>
          )}
          {!data && !catalogError && (
            <RunnerFeedback kind="status" title="Finding your races…" />
          )}
          {data && data.runners.length === 0 && (
            <RunnerFeedback kind="empty" title="No BIBs yet.">
              <p>Add one above, or use a claim code from your organizer.</p>
            </RunnerFeedback>
          )}
          {data && data.runners.length > 0 && (
            <ul className="registration-grid" role="list">
              {data.runners.map((runner) => (
                <li className="registration-card" key={runner.id}>
                  <div>
                    <h3>{runner.event}</h3>
                    <p className="registration-event">{runner.name}</p>
                    <p className="registration-meta">
                      <span>{runner.category}</span>
                      <span>
                        {runner.bib_number ? `BIB ${runner.bib_number}` : "BIB unassigned"}
                      </span>
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
