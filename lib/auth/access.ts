import "server-only";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

export class AccessDeniedError extends Error {
  constructor() { super("Access denied."); this.name = "AccessDeniedError"; }
}

export async function requireOrganizerAccess(userId: string, eventId: number): Promise<void> {
  const { data, error } = await getSupabaseAdmin().from("organizer_access")
    .select("event_id").eq("user_id", userId).eq("event_id", eventId).maybeSingle();
  if (error) throw new Error("Access verification is unavailable.");
  if (!data) throw new AccessDeniedError();
}

export async function requireRunnerAccess(userId: string, runnerId: string): Promise<void> {
  const db = getSupabaseAdmin();
  const mapping = await db.from("runner_access").select("runner_id")
    .eq("user_id", userId).eq("runner_id", runnerId).maybeSingle();
  if (mapping.error) throw new Error("Access verification is unavailable.");
  if (mapping.data) return;
  const runner = await db.from("runners").select("category_id").eq("id", runnerId).maybeSingle();
  if (runner.error) throw new Error("Access verification is unavailable.");
  if (!runner.data) throw new AccessDeniedError();
  const category = await db.from("categories").select("event_id").eq("id", runner.data.category_id).maybeSingle();
  if (category.error) throw new Error("Access verification is unavailable.");
  if (!category.data) throw new AccessDeniedError();
  await requireOrganizerAccess(userId, category.data.event_id);
}
