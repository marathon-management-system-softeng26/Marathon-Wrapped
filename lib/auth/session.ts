import "server-only";
import { createSupabaseSession } from "@/lib/supabaseSession";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";

export class AuthenticationError extends Error {
  constructor() {
    super("Sign in to view your race recap.");
    this.name = "AuthenticationError";
  }
}

export async function requireUser(): Promise<{ id: string }> {
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
  return { id: data.user.id };
}
