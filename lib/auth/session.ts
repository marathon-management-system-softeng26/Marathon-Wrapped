import "server-only";
import { createSupabaseSession } from "@/lib/supabaseSession";

export class AuthenticationError extends Error {
  constructor() { super("Sign in to view your race recap."); this.name = "AuthenticationError"; }
}

export async function requireUser(): Promise<{ id: string }> {
  const client = await createSupabaseSession();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new AuthenticationError();
  return { id: data.user.id };
}
