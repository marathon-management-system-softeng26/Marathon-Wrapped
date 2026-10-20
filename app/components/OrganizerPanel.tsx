"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useCatalog } from "./useCatalog";
import AppHeader from "./AppHeader";
import type { HeroRunnerDraft } from "@/lib/heroValidation";
import { formatMmSs } from "@/lib/format";
import { changeDraftCategory } from "@/lib/organizerDraft";
type Row = {
  runner_id: string;
  name: string;
  bib_number: string;
  category: string;
  status: string;
  elapsed_seconds: number | null;
  category_rank: number | null;
};
const empty: HeroRunnerDraft = {
  name: "",
  bib_number: "",
  date_of_birth: "",
  gender: "F",
  category: "5K",
  parental_consent: false,
  result: null,
  splits: [],
};
export default function OrganizerPanel() {
  const { data, error: catalogError, retry } = useCatalog();
  const [eventId, setEventId] = useState(""),
    [rows, setRows] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [version, setVersion] = useState(0),
    [draft, setDraft] = useState<HeroRunnerDraft | null>(null),
    [editing, setEditing] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const selected = eventId || String(data?.events[0]?.id ?? "");
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    fetch(`/api/organizer/events/${selected}/results`, {
      cache: "no-store",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]),
    })
      .then(async (response) => {
        if (response.status === 401) {
          window.location.replace("/login");
          return;
        }
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        setRows(body.results ?? body);
        setError("");
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [selected, version]);
  async function edit(id: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/organizer/events/${selected}/runners/${id}`,
        { cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setDraft(body);
      setEditing(id);
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : "Runner could not load.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/organizer/events/${selected}/runners${editing ? `/${editing}` : ""}`,
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setDraft(null);
      setEditing(null);
      setMessage("Runner saved. Results and ranks have been refreshed.");
      setLoading(true);
      setVersion((v) => v + 1);
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "Save failed. Your draft is preserved.",
      );
    } finally {
      setBusy(false);
    }
  }
  function field<K extends keyof HeroRunnerDraft>(
    key: K,
    value: HeroRunnerDraft[K],
  ) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }
  const status = !draft?.result
    ? "unavailable"
    : draft.result.start_status === "dns"
      ? "dns"
      : draft.result.finisher
        ? "finisher"
        : "dnf";
  function changeStatus(value: string) {
    if (!draft) return;
    field(
      "result",
      value === "unavailable"
        ? null
        : {
            finisher: value === "finisher",
            start_status: value === "dns" ? "dns" : "on-time",
            start_time:
              value === "dns" ? null : (draft.result?.start_time ?? null),
            finish_time:
              value === "finisher" ? (draft.result?.finish_time ?? null) : null,
          },
    );
    if (value === "dns" || value === "unavailable") field("splits", []);
  }
  return (
    <div className="workspace">
      <AppHeader />
      <main className="content organizer">
        <Link href="/">← Your races</Link>
        <h1>Race control.</h1>
        <p>
          Manage synthetic runners and chip results. Saves replace timing and
          splits together.
        </p>
        {catalogError ? (
          <p role="alert">
            {catalogError} <button onClick={retry}>Try again</button>
          </p>
        ) : !data ? (
          <p role="status">Checking event access…</p>
        ) : !data.events.length ? (
          <p>You do not have organizer access to an event.</p>
        ) : (
          <>
            <div className="toolbar">
              <label>
                Event
                <select
                  value={selected}
                  disabled={busy || !!draft}
                  onChange={(event) => {
                    setEventId(event.target.value);
                    setRows([]);
                    setLoading(true);
                  }}
                >
                  {data.events.map((event) => (
                    <option key={event.id} value={event.id}>
                      {event.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                disabled={busy || !!draft}
                onClick={() => {
                  setDraft({ ...empty });
                  setEditing(null);
                  setMessage("");
                }}
              >
                Add runner
              </button>
            </div>
            {error && (
              <p role="alert">
                {error}{" "}
                <button onClick={() => setVersion((v) => v + 1)}>
                  Retry results
                </button>
              </p>
            )}
            {message && (
              <p role="status" className="save-message">
                {message}
              </p>
            )}
            {draft && (
              <form className="runner-editor" onSubmit={save}>
                <h2>{editing ? "Edit runner" : "Add a hero runner"}</h2>
                <p>
                  5K minimum age 13; 10K minimum age 17. Under 17 needs parental
                  consent. BIB cannot change after assignment.
                </p>
                <fieldset disabled={busy}>
                  <div className="form-grid">
                    <label>
                      Name
                      <input
                        required
                        maxLength={120}
                        value={draft.name}
                        onChange={(e) => field("name", e.target.value)}
                      />
                    </label>
                    <label>
                      BIB
                      <input
                        required
                        readOnly={!!editing}
                        pattern="[A-Za-z0-9-]+"
                        maxLength={40}
                        value={draft.bib_number}
                        onChange={(e) => field("bib_number", e.target.value)}
                      />
                    </label>
                    <label>
                      Date of birth
                      <input
                        required
                        type="date"
                        value={draft.date_of_birth}
                        onChange={(e) => field("date_of_birth", e.target.value)}
                      />
                    </label>
                    <label>
                      Gender
                      <select
                        value={draft.gender}
                        onChange={(e) =>
                          field("gender", e.target.value as "M" | "F")
                        }
                      >
                        <option value="F">Female</option>
                        <option value="M">Male</option>
                      </select>
                    </label>
                    <label>
                      Category
                      <select
                        value={draft.category}
                        onChange={(e) =>
                          setDraft(
                            changeDraftCategory(
                              draft,
                              e.target.value as "5K" | "10K",
                            ),
                          )
                        }
                      >
                        <option>5K</option>
                        <option>10K</option>
                      </select>
                    </label>
                    <label>
                      Result
                      <select
                        value={status}
                        onChange={(e) => changeStatus(e.target.value)}
                      >
                        <option value="unavailable">Not published</option>
                        <option value="finisher">Finisher</option>
                        <option value="dnf">Did not finish</option>
                        <option value="dns">Did not start</option>
                      </select>
                    </label>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={draft.parental_consent}
                        onChange={(e) =>
                          field("parental_consent", e.target.checked)
                        }
                      />
                      Parental consent recorded
                    </label>
                    {draft.result && status !== "dns" && (
                      <>
                        <label>
                          Start status
                          <select
                            value={draft.result.start_status}
                            onChange={(e) =>
                              field("result", {
                                ...draft.result!,
                                start_status: e.target.value as
                                  "on-time" | "late",
                              })
                            }
                          >
                            <option value="on-time">On time</option>
                            <option value="late">Late</option>
                          </select>
                        </label>
                        <label>
                          Start timestamp (include timezone)
                          <input
                            required
                            placeholder="2027-08-17T06:00:00+07:00"
                            value={draft.result.start_time ?? ""}
                            onChange={(e) =>
                              field("result", {
                                ...draft.result!,
                                start_time: e.target.value,
                              })
                            }
                          />
                        </label>
                        {status === "finisher" && (
                          <label>
                            Finish timestamp (include timezone)
                            <input
                              required
                              placeholder="2027-08-17T06:25:23+07:00"
                              value={draft.result.finish_time ?? ""}
                              onChange={(e) =>
                                field("result", {
                                  ...draft.result!,
                                  finish_time: e.target.value,
                                })
                              }
                            />
                          </label>
                        )}
                        <div className="split-editor">
                          <h3>Kilometer splits</h3>
                          <p>
                            Seconds per kilometer. All kilometers are required
                            for a finisher and must total the chip duration.
                            Leave unrecorded DNF kilometers empty.
                          </p>
                          <div className="split-inputs">
                            {Array.from(
                              { length: draft.category === "5K" ? 5 : 10 },
                              (_, i) => i + 1,
                            ).map((km) => (
                              <label key={km}>
                                km {km}
                                <input
                                  type="number"
                                  min="0.001"
                                  step="any"
                                  required={status === "finisher"}
                                  value={
                                    draft.splits.find((s) => s.km_marker === km)
                                      ?.split_seconds ?? ""
                                  }
                                  onChange={(e) =>
                                    field("splits", [
                                      ...draft.splits.filter(
                                        (s) => s.km_marker !== km,
                                      ),
                                      ...(e.target.value
                                        ? [
                                            {
                                              km_marker: km,
                                              split_seconds: Number(
                                                e.target.value,
                                              ),
                                            },
                                          ]
                                        : []),
                                    ])
                                  }
                                />
                              </label>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                  <div className="form-actions">
                    <button type="submit">
                      {busy ? "Saving…" : "Save runner"}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setDraft(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </fieldset>
              </form>
            )}
            {loading ? (
              <p role="status">Refreshing results…</p>
            ) : (
              <div className="table-scroll">
                <table>
                  <caption>Event results · Synthetic demo data</caption>
                  <thead>
                    <tr>
                      <th>Runner / BIB</th>
                      <th>Category</th>
                      <th>Result</th>
                      <th>Finish</th>
                      <th>Rank</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.runner_id}>
                        <td>
                          <b>{row.name}</b>
                          <small>{row.bib_number}</small>
                        </td>
                        <td>{row.category}</td>
                        <td>
                          {
                            {
                              finisher: "Finished",
                              dnf: "Did not finish",
                              dns: "Did not start",
                              unavailable: "Not published",
                            }[row.status]
                          }
                        </td>
                        <td>
                          {row.elapsed_seconds == null
                            ? "—"
                            : formatMmSs(row.elapsed_seconds)}
                        </td>
                        <td>{row.category_rank ?? "—"}</td>
                        <td>
                          <div className="row-actions">
                            <Link href={`/wrapped/${row.runner_id}`}>
                              Recap
                            </Link>
                            <button
                              className="quiet"
                              disabled={busy || !!draft}
                              onClick={() => edit(row.runner_id)}
                            >
                              Edit
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!rows.length && (
                  <p>No runners in this event yet. Add a runner to begin.</p>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
