import type { CategoryName, ChipSplit, Gender, StartStatus } from "./types";

export class HeroValidationError extends Error {
  constructor(message = "Check the runner fields, timing and kilometer splits.") { super(message); this.name = "HeroValidationError"; }
}
export type HeroRunnerDraft = {
  name: string; bib_number: string; date_of_birth: string; gender: Gender;
  parental_consent: boolean; category: CategoryName;
  result: { finisher: boolean; start_status: StartStatus; start_time: string | null; finish_time: string | null } | null;
  splits: ChipSplit[];
};
function fail(): never { throw new HeroValidationError(); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) fail();
  return value.trim();
}
function time(value: unknown): string {
  const result = text(value, 40);
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(result) || !Number.isFinite(Date.parse(result))) fail();
  return result;
}
export function validateHeroDraft(value: unknown): HeroRunnerDraft {
  const row = object(value);
  const name = text(row.name, 120), bib_number = text(row.bib_number, 40);
  if (!/^[a-z0-9-]+$/i.test(bib_number)) fail();
  const date_of_birth = text(row.date_of_birth, 10);
  const birthday = new Date(date_of_birth + "T00:00:00Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date_of_birth) || !Number.isFinite(birthday.getTime()) || birthday.toISOString().slice(0,10) !== date_of_birth) fail();
  const gender = row.gender, category = row.category;
  if (gender !== "M" && gender !== "F") fail();
  if (category !== "5K" && category !== "10K") fail();
  if (typeof row.parental_consent !== "boolean" || !Array.isArray(row.splits)) fail();
  const distance = category === "5K" ? 5 : 10;
  const seen = new Set<number>();
  const splits = row.splits.map(value => {
    const split = object(value), km = split.km_marker, seconds = split.split_seconds;
    if (typeof km !== "number" || !Number.isInteger(km) || km < 1 || km > distance || seen.has(km)) fail();
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) fail();
    seen.add(km); return { km_marker: km, split_seconds: seconds };
  }).sort((a,b) => a.km_marker-b.km_marker);
  let result: HeroRunnerDraft["result"] = null;
  if (row.result !== null) {
    const raw = object(row.result), status = raw.start_status;
    if (typeof raw.finisher !== "boolean" || (status !== "on-time" && status !== "late" && status !== "dns")) fail();
    if (status === "dns") {
      if (raw.finisher || raw.start_time !== null || raw.finish_time !== null || splits.length) fail();
      result = { finisher: false, start_status: status, start_time: null, finish_time: null };
    } else {
      const start_time = time(raw.start_time);
      const finish_time = raw.finisher ? time(raw.finish_time) : null;
      if (!raw.finisher && raw.finish_time !== null) fail();
      if (finish_time) {
        const seconds = Math.round((Date.parse(finish_time)-Date.parse(start_time))/1000);
        if (seconds <= 0 || splits.length !== distance || Math.abs(splits.reduce((n,s) => n+s.split_seconds,0)-seconds)>1) fail();
      }
      result = { finisher: raw.finisher, start_status: status, start_time, finish_time };
    }
  } else if (splits.length) fail();
  return { name, bib_number, date_of_birth, gender, parental_consent: row.parental_consent, category, result, splits };
}
