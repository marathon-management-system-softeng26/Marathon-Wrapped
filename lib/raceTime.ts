/**
 * The race's own wall clock, shared by every organizer control that edits an instant.
 *
 * Pure conversion only. A `datetime-local` control has no offset, so the browser sends what the
 * organizer saw and these helpers attach the race's zone on the way out and strip it on the way in.
 * Asia/Jakarta observes no daylight saving, so the fixed offset below is exact year-round.
 */

export const RACE_TIME_ZONE = "Asia/Jakarta";
export const RACE_UTC_OFFSET = "+07:00";
export const RACE_TIME_ZONE_LABEL = "WIB";

/**
 * An ISO instant rendered for a `datetime-local` control, kept in the race's own offset.
 *
 * Chip timing is second-precision and splits must total the elapsed time to within a second, so
 * controls that edit a chip time ask for `seconds` and pair it with `step="1"`.
 */
export function toRaceLocalInput(
  iso: string | null | undefined,
  { seconds = false }: { seconds?: boolean } = {},
): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" as const } : {}),
    hourCycle: "h23",
    timeZone: RACE_TIME_ZONE,
  }).format(date);
  return parts.replace(" ", "T");
}

// A control's value is normalized by the browser before it is read back: a whole-minute time
// loses its ":00" seconds, and some engines add a fractional part. Both forms are parsed here
// rather than inferred from the string's length.
const LOCAL_DATE_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/;

/**
 * A `datetime-local` value with the race's offset attached, always at second precision. Chip
 * timing is whole seconds, so a fractional part is dropped rather than carried into storage.
 *
 * Anything that is not a recognisable local date and time passes through untouched, so an empty,
 * missing or malformed field reaches the server as it was and is rejected there with the server's
 * own message rather than becoming a plausible-looking instant.
 */
export function withRaceZone<T>(value: T): T | string {
  if (typeof value !== "string" || value === "") return value;
  const match = LOCAL_DATE_TIME.exec(value);
  if (!match) return value;
  const [, date, hour, minute, second = "00"] = match;
  return `${date}T${hour}:${minute}:${second}${RACE_UTC_OFFSET}`;
}
