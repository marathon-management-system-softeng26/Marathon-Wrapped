import "server-only";
import { getSupabaseAdmin } from "./supabaseServer";
export async function getRunnerCatalog(userId: string) {
  const db = getSupabaseAdmin();
  const [own, organizer] = await Promise.all([
    db.from("runner_access").select("runner_id").eq("user_id", userId),
    db.from("organizer_access").select("event_id").eq("user_id", userId),
  ]);
  if (own.error || organizer.error) throw new Error("Access unavailable");
  const eventIds = organizer.data.map((row) => row.event_id);
  const events = eventIds.length
    ? await db.from("events").select("id,name").in("id", eventIds)
    : { data: [], error: null };
  const categories = eventIds.length
    ? await db.from("categories").select("id").in("event_id", eventIds)
    : { data: [], error: null };
  if (events.error || categories.error) throw new Error("Events unavailable");
  const ids = new Set(own.data.map((row) => row.runner_id));
  if (categories.data.length) {
    const scoped = await db
      .from("runners")
      .select("id")
      .in(
        "category_id",
        categories.data.map((row) => row.id),
      );
    if (scoped.error) throw new Error("Runners unavailable");
    scoped.data.forEach((row) => ids.add(row.id));
  }
  if (!ids.size) return { runners: [], events: events.data };
  const runners = await db
    .from("runners")
    .select("id,name,bib_number")
    .in("id", [...ids])
    .order("name");
  if (runners.error) throw new Error("Runners unavailable");
  return { runners: runners.data, events: events.data };
}
