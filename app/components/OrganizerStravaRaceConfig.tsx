"use client";
import { useEffect, useState, type FormEvent } from "react";
import type { StravaRaceConfig } from "@/lib/strava/raceConfig";

type CategoryConfig = { id: number; name: string; config: StravaRaceConfig | null };

/** An ISO instant rendered for a datetime-local control, kept in the race's own offset. */
const localValue = (iso: string | undefined) => {
  if (!iso) return "";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("sv-SE", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    hourCycle: "h23", timeZone: "Asia/Jakarta",
  }).format(date);
  return parts.replace(" ", "T");
};

const number = (value: FormDataEntryValue | null) => {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
};

/**
 * Organizer-managed matching parameters per category. The browser sends what the organizer
 * typed and the server is the authority: every message shown here comes from its response.
 */
export default function OrganizerStravaRaceConfig({ eventId }: { eventId: string }) {
  const [categories, setCategories] = useState<CategoryConfig[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/organizer/events/${encodeURIComponent(eventId)}/strava-config`, {
      cache: "no-store", credentials: "same-origin",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]),
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Race settings are unavailable.");
        setCategories(body.categories ?? []);
        setError("");
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Race settings are unavailable.");
      });
    return () => controller.abort();
  }, [eventId, version]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setNotice("");
    setError("");
    try {
      // A datetime-local value carries no offset, so the race's own zone is attached here.
      const withZone = (value: FormDataEntryValue | null) =>
        typeof value === "string" && value ? `${value.length === 16 ? `${value}:00` : value}+07:00` : value;
      const response = await fetch(`/api/organizer/events/${encodeURIComponent(eventId)}/strava-config`, {
        method: "PUT", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId: number(form.get("categoryId")),
          startTimeFrom: withZone(form.get("startTimeFrom")),
          startTimeTo: withZone(form.get("startTimeTo")),
          distanceToleranceM: number(form.get("distanceToleranceM")),
          startLatitude: number(form.get("startLatitude")),
          startLongitude: number(form.get("startLongitude")),
          startRadiusM: number(form.get("startRadiusM")),
        }),
        signal: AbortSignal.timeout(12000),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Race settings could not be saved.");
      setNotice("Race settings saved.");
      setVersion((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Race settings could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="organizer-race-config" aria-labelledby="organizer-race-config-heading">
      <h3 id="organizer-race-config-heading">Strava race matching</h3>
      <p>
        These settings decide which saved Strava activity can belong to a race. Only Run activities are matched.
        The start location is optional and is never shown to runners.
      </p>
      {error && <p role="alert">{error}</p>}
      <p role="status">{notice}</p>
      {!categories && !error && <p className="loading">Loading race settings…</p>}
      {categories?.length === 0 && <p>Add a category to this event before configuring race matching.</p>}
      {categories?.map((category) => (
        <form key={category.id} onSubmit={save} aria-busy={saving} aria-label={`Race matching for ${category.name}`}>
          <h4>{category.name}</h4>
          <input type="hidden" name="categoryId" value={category.id} />
          <div className="organizer-config-fields">
            <label>
              Window start (WIB)
              <input type="datetime-local" name="startTimeFrom" required defaultValue={localValue(category.config?.startTimeFrom)} />
            </label>
            <label>
              Window end (WIB)
              <input type="datetime-local" name="startTimeTo" required defaultValue={localValue(category.config?.startTimeTo)} />
            </label>
            <label>
              Distance tolerance (m)
              <input type="number" name="distanceToleranceM" min={1} max={5000} step={1} required
                defaultValue={category.config?.distanceToleranceM ?? 500} />
            </label>
            <label>
              Start latitude (optional)
              <input type="number" name="startLatitude" step="any" min={-90} max={90} defaultValue={category.config?.startLatitude ?? ""} />
            </label>
            <label>
              Start longitude (optional)
              <input type="number" name="startLongitude" step="any" min={-180} max={180} defaultValue={category.config?.startLongitude ?? ""} />
            </label>
            <label>
              Start radius (m, optional)
              <input type="number" name="startRadiusM" step="any" min={0} defaultValue={category.config?.startRadiusM ?? ""} />
            </label>
          </div>
          <button type="submit" disabled={saving}>{saving ? "Saving…" : "Save race settings"}</button>
        </form>
      ))}
    </section>
  );
}
