"use client";

/**
 * A mailed claim link arrives as `/?claim=<token>`. The token is a bearer credential, so
 * it is lifted out of the URL on arrival: the address bar, the history entry, and any
 * later referrer keep no copy. Session storage carries it across the sign-in redirect,
 * which replaces the location and would otherwise drop it.
 *
 * Readers subscribe through `useSyncExternalStore`. The server snapshot is empty, so a
 * prerendered field stays blank and the token appears only once the browser has it.
 */

const KEY = "marathon-wrapped:claim";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

let snapshot = "";
let captured = false;
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((listener) => listener());

function stored(): string {
  try {
    const token = window.sessionStorage.getItem(KEY) ?? "";

    return TOKEN_PATTERN.test(token) ? token : "";
  } catch {
    return "";
  }
}

/**
 * Move a token from the URL into session storage. Safe to call more than once: the query
 * carries the token only on the first visit from the mail.
 */
export function captureClaimToken(): void {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  const token = url.searchParams.get("claim");

  if (token === null) return;

  url.searchParams.delete("claim");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);

  if (!TOKEN_PATTERN.test(token)) return;

  try {
    window.sessionStorage.setItem(KEY, token);
  } catch {
    // Private browsing can refuse storage, so hold the token for this page instead.
  }

  snapshot = token;
  notify();
}

/** Forget a token once it has been spent, so a reload cannot re-fill a used code. */
export function clearClaimToken(): void {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Nothing was stored.
  }

  snapshot = "";
  notify();
}

/**
 * React calls this in a passive effect after mount, which is the first moment the URL and
 * session storage may be read without risking a hydration mismatch.
 */
export function subscribeClaimToken(listener: () => void): () => void {
  listeners.add(listener);

  if (!captured) {
    captured = true;
    captureClaimToken();

    if (!snapshot) {
      snapshot = stored();
      if (snapshot) notify();
    }
  }

  return () => listeners.delete(listener);
}

export const claimTokenSnapshot = () => snapshot;

export const serverClaimTokenSnapshot = () => "";

/** Test seam: forget that this page has already read the URL. */
export function resetClaimHandoff(): void {
  snapshot = "";
  captured = false;
  listeners.clear();
}
