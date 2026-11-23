import "server-only";
import { createSupabaseSession } from "@/lib/supabaseSession";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";

export class AuthenticationError extends Error {
  constructor() {
    super("Sign in to view your race recap.");
    this.name = "AuthenticationError";
  }
}

/**
 * A verified session whose address is not confirmed yet. Separate from `AuthenticationError`
 * because the caller is signed in: telling them to sign in again would be a dead end.
 */
export class UnconfirmedEmailError extends Error {
  constructor() {
    super("Confirm your email address before adding a BIB.");
    this.name = "UnconfirmedEmailError";
  }
}

export async function requireUser(): Promise<{ id: string; email: string | null; emailConfirmedAt: string | null }> {
  const client = await createSupabaseSession();
  const { data, error } = await client.auth.getUser();
  if (
    error &&
    (isAuthRetryableFetchError(error) ||
      error.status === 0 ||
      error.status === 429 ||
      (error.status ?? 0) >= 500)
  ) {
    throw new Error("Authentication is temporarily unavailable. Please retry.");
  }
  if (error || !data.user) throw new AuthenticationError();
  // Identity comes from the verified session only, never from user metadata.
  return {
    id: data.user.id,
    email: data.user.email ?? null,
    emailConfirmedAt: data.user.email_confirmed_at ?? null,
  };
}

/**
 * A verified session that has also confirmed its address. Required where a request can be used to
 * probe for registrations that do not belong to the caller: the per-account throttle on BIB
 * linking is only a cost if an account is worth more than a throwaway address. FR-01 asks for
 * confirmation before claiming a registration, and this is where that is enforced.
 */
export async function requireConfirmedUser() {
  const user = await requireUser();
  if (!user.emailConfirmedAt) throw new UnconfirmedEmailError();
  return user;
}
