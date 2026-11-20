/**
 * Race-day eligibility for a registration's date of birth.
 *
 * Pure date arithmetic that mirrors the database's `check_runner_eligibility()` trigger: it
 * compares a runner's age **on race day** against their category's `min_age`, and requires
 * parental consent below `CONSENT_AGE`. The trigger stays the authority — these helpers exist so
 * the organizer form states and enforces the same rule where the date is actually typed, instead
 * of turning a knowable mistake into a generic save rejection.
 */

import type { CategoryName } from "./types";

/** Used only when an event payload omits a category's own `min_age`. */
export const DEFAULT_MIN_AGE: Record<CategoryName, number> = { "5K": 13, "10K": 17 };

/** Below this age on race day the trigger also demands recorded parental consent. */
export const CONSENT_AGE = 17;

type Parts = [year: number, month: number, day: number];

/** A calendar date, accepted only when it round-trips — so no 31 February. */
function parts(date: string | null | undefined): Parts | null {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split("-").map(Number) as Parts;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === date ? [year, month, day] : null;
}

const iso = ([year, month, day]: Parts) =>
  `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

const lastDayOfMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * The newest date of birth that still clears `minAge` on race day, suitable for a date input's
 * `max`. The bound is inclusive: Postgres `age()` counts whole years, so a runner born exactly
 * this many years before the race turns `minAge` on race day and is eligible. A 29 February race
 * date clamps to 28 February, the last birth date that qualifies in a non-leap target year.
 */
export function latestEligibleBirthDate(eventDate: string | null | undefined, minAge: number): string {
  const race = parts(eventDate);
  if (!race || !Number.isInteger(minAge) || minAge < 0) return "";
  const [year, month, day] = race;
  const target = year - minAge;
  return iso([target, month, Math.min(day, lastDayOfMonth(target, month))]);
}

/** Whole years completed on race day, matching `age_on(dob, event_date)`. */
export function ageOnRaceDay(dateOfBirth: string | null | undefined, eventDate: string | null | undefined): number | null {
  const birth = parts(dateOfBirth);
  const race = parts(eventDate);
  if (!birth || !race) return null;
  const beforeBirthday = race[1] < birth[1] || (race[1] === birth[1] && race[2] < birth[2]);
  return race[0] - birth[0] - (beforeBirthday ? 1 : 0);
}

/** A runner this young on race day cannot be saved without recorded parental consent. */
export function requiresParentalConsent(dateOfBirth: string | null | undefined, eventDate: string | null | undefined): boolean {
  const age = ageOnRaceDay(dateOfBirth, eventDate);
  return age !== null && age < CONSENT_AGE;
}

const readable = (date: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${date}T00:00:00Z`));

/** The rule, in the organizer's words, for the help text under a date-of-birth field. */
export function describeAgeRule(category: CategoryName, minAge: number, eventDate: string | null | undefined): string {
  const latest = latestEligibleBirthDate(eventDate, minAge);
  const race = parts(eventDate);
  if (!latest || !race) return `A ${category} runner must be ${minAge} on race day.`;
  return `A ${category} runner must be ${minAge} on race day (${readable(iso(race))}). Latest date of birth: ${readable(latest)}.`;
}

/**
 * Why this date of birth cannot be saved, or an empty string when it can. An empty or incomplete
 * date reports nothing: the field's own `required` attribute covers that.
 */
export function describeEligibilityProblem(
  dateOfBirth: string | null | undefined,
  eventDate: string | null | undefined,
  category: CategoryName,
  minAge: number,
  parentalConsent: boolean,
): string {
  const age = ageOnRaceDay(dateOfBirth, eventDate);
  if (age === null) return "";
  if (age < minAge) {
    return `This runner is ${age} on race day. ${describeAgeRule(category, minAge, eventDate)}`;
  }
  if (age < CONSENT_AGE && !parentalConsent) {
    return `This runner is ${age} on race day. Under ${CONSENT_AGE} needs recorded parental consent.`;
  }
  return "";
}
