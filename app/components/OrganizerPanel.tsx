"use client";
import { useEffect, useId, useState, type FormEvent } from "react";
import Link from "next/link";
import { useCatalog } from "./useCatalog";
import AppHeader from "./AppHeader";
import type { HeroRunnerDraft } from "@/lib/heroValidation";
import type { CategoryName } from "@/lib/types";
import { formatMmSs } from "@/lib/format";
import { changeDraftCategory } from "@/lib/organizerDraft";
import { toRaceLocalInput, withRaceZone } from "@/lib/raceTime";
import {
  DEFAULT_MIN_AGE,
  describeAgeRule,
  describeEligibilityProblem,
  latestEligibleBirthDate,
} from "@/lib/eligibility";
import OrganizerEnrichmentEditor from "./OrganizerEnrichmentEditor";
import OrganizerRunnerAccess from "./OrganizerRunnerAccess";
import OrganizerStravaRaceConfig from "./OrganizerStravaRaceConfig";
import RunnerFeedback from "./RunnerFeedback";
type EventSummary = { name: string; event_date: string } | null;
type CategoryRule = { name: string; min_age: number };
type Row = {
  runner_id: string;
  name: string;
  bib_number: string;
  category: string;
  status: string;
  elapsed_seconds: number | null;
  category_rank: number | null;
  linked?: boolean;
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
  enrichment: { metrics: null, photos: [] },
};
export default function OrganizerPanel() {
  const { data, error: catalogError, retry } = useCatalog();
  const dobProblemId = useId();
  const [eventId, setEventId] = useState(""),
    [rows, setRows] = useState<Row[]>([]),
    [event, setEvent] = useState<EventSummary>(null),
    [rules, setRules] = useState<CategoryRule[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [version, setVersion] = useState(0),
    [draft, setDraft] = useState<HeroRunnerDraft | null>(null),
    [editing, setEditing] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [messageError, setMessageError] = useState(false);
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
        setEvent(body.event ?? null);
        setRules(body.categories ?? []);
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
    setMessageError(false);
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
      setMessageError(true);
      setMessage(
        cause instanceof Error ? cause.message : "Runner could not load.",
      );
    } finally {
      setBusy(false);
    }
  }
  // The database decides eligibility from the race date and the category's own minimum. Both
  // travel with the results, so the form can apply the same rule instead of letting a knowable
  // mistake come back as a generic save rejection.
  const raceDate = event?.event_date ?? null;
  const minAgeFor = (category: CategoryName) =>
    rules.find((rule) => rule.name === category)?.min_age ?? DEFAULT_MIN_AGE[category];
  const minAge = draft ? minAgeFor(draft.category) : DEFAULT_MIN_AGE["5K"];
  const ageRule = draft ? describeAgeRule(draft.category, minAge, raceDate) : "";
  const eligibilityProblem = draft
    ? describeEligibilityProblem(
        draft.date_of_birth,
        raceDate,
        draft.category,
        minAge,
        draft.parental_consent,
      )
    : "";

  async function save(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    if (!draft) return;
    if (eligibilityProblem) {
      setMessageError(true);
      setMessage(eligibilityProblem);
      return;
    }
    setBusy(true);
    setMessage("");
    setMessageError(false);
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
      setMessageError(true);
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
      <AppHeader showOrganizerLink />
      <main className="content organizer organizer-shell">
        <Link href="/">← Your races</Link>
        <header className="organizer-hero">
        <p className="organizer-kicker">Organizer console</p>
        <h1>Race control.</h1>
        <p>
          Manage synthetic runners and chip results. Saves replace timing and
          splits together.
        </p>
        </header>
        {catalogError ? (
          <RunnerFeedback kind="error" title={catalogError}><button onClick={retry}>Try again</button></RunnerFeedback>
        ) : !data ? (
          <RunnerFeedback kind="status" title="Checking event access…" />
        ) : !data.events.length ? (
          <RunnerFeedback kind="empty" title="No organizer access"><p>You do not have organizer access to an event.</p></RunnerFeedback>
        ) : (
          <>
            <div className="toolbar">
              <label>
                Event
                <select
                  value={selected}
                  disabled={busy || !!draft}
                  onChange={(change) => {
                    setEventId(change.target.value);
                    setRows([]);
                    setLoading(true);
                  }}
                >
                  {data.events.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
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
              <RunnerFeedback kind="error" title={error}>
                <button onClick={() => setVersion((v) => v + 1)}>
                  Retry results
                </button>
              </RunnerFeedback>
            )}
            {message && (
              <RunnerFeedback kind={messageError ? "error" : "status"} title={message} />
            )}
            {draft && (
              <form className="runner-editor" onSubmit={save}>
                <h2>{editing ? "Edit runner" : "Add a hero runner"}</h2>
                <p>
                  {ageRule} Under 17 needs parental consent. BIB cannot change
                  after assignment.
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
                        max={latestEligibleBirthDate(raceDate, minAge) || undefined}
                        aria-describedby={eligibilityProblem ? dobProblemId : undefined}
                        value={draft.date_of_birth}
                        onChange={(e) => field("date_of_birth", e.target.value)}
                      />
                      {eligibilityProblem && (
                        <small className="field-problem" id={dobProblemId} role="alert">
                          {eligibilityProblem}
                        </small>
                      )}
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
                          Start time (WIB)
                          <input
                            required
                            type="datetime-local"
                            step="1"
                            value={toRaceLocalInput(draft.result.start_time, {
                              seconds: true,
                            })}
                            onChange={(e) =>
                              field("result", {
                                ...draft.result!,
                                start_time: e.target.value
                                  ? withRaceZone(e.target.value)
                                  : null,
                              })
                            }
                          />
                        </label>
                        {status === "finisher" && (
                          <label>
                            Finish time (WIB)
                            <input
                              required
                              type="datetime-local"
                              step="1"
                              value={toRaceLocalInput(draft.result.finish_time, {
                                seconds: true,
                              })}
                              onChange={(e) =>
                                field("result", {
                                  ...draft.result!,
                                  finish_time: e.target.value
                                    ? withRaceZone(e.target.value)
                                    : null,
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
                  <OrganizerEnrichmentEditor
                    value={draft.enrichment ?? { metrics: null, photos: [] }}
                    distance={draft.category === "5K" ? 5 : 10}
                    onChange={(value) => field("enrichment", value)}
                  />
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
              <RunnerFeedback kind="status" title="Refreshing results…" />
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
            {!!rows.length && (
              <OrganizerRunnerAccess
                eventId={selected}
                rows={rows.map((row) => ({
                  runner_id: row.runner_id, name: row.name, bib_number: row.bib_number,
                  category: row.category, linked: row.linked === true,
                }))}
              />
            )}
            <OrganizerStravaRaceConfig eventId={selected} />
          </>
        )}
      </main>
    </div>
  );
}
