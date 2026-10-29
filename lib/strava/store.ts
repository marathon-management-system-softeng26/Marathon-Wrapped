import "server-only";
import { getSupabaseAdmin } from "../supabaseServer";

export async function stravaRpc<T>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await getSupabaseAdmin().rpc(name, args);

  if (error) {
    throw new Error("Strava storage is temporarily unavailable.");
  }

  return data as T;
}
