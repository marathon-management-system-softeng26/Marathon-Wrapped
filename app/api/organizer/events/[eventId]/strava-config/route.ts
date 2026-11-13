import { requireUser } from "@/lib/auth/session";
import { requireOrganizerAccess } from "@/lib/auth/access";
import { eventIdFrom, organizerError, organizerFailure, organizerNotFound, privateHeaders } from "@/lib/organizerHttp";
import { sameOrigin } from "@/lib/authHttp";
import { fromConfigRow, parseStravaRaceConfig, RaceConfigError, toConfigRow } from "@/lib/strava/raceConfig";
import { getSupabaseAdmin } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ eventId: string }> };
type CategoryRow = { id: number; name: string };

const unavailable = () => organizerError("Race configuration is temporarily unavailable. Please retry.", 503);

/** Categories are the unit of configuration, and only those owned by this event are visible. */
async function eventCategories(eventId: number): Promise<CategoryRow[]> {
  const result = await getSupabaseAdmin().from("categories").select("id,name").eq("event_id", eventId).order("id");
  if (result.error) throw new Error("categories unavailable");
  return (result.data ?? []) as CategoryRow[];
}

export async function GET(_request: Request, context: Context) {
  const eventId = eventIdFrom((await context.params).eventId);
  if (!eventId) return organizerError("Invalid event identifier.", 400);
  try {
    const user = await requireUser();
    await requireOrganizerAccess(user.id, eventId);
    const categories = await eventCategories(eventId);
    if (!categories.length) return Response.json({ categories: [] }, { headers: privateHeaders });
    const stored = await getSupabaseAdmin()
      .from("strava_race_configs")
      .select("category_id,start_time_from,start_time_to,allowed_sport_types,distance_tolerance_m,start_latitude,start_longitude,start_radius_m")
      .in("category_id", categories.map((category) => category.id));
    if (stored.error) return unavailable();
    const byCategory = new Map((stored.data ?? []).map((row) => [row.category_id, row]));
    return Response.json({
      categories: categories.map((category) => {
        const row = byCategory.get(category.id);
        return { id: category.id, name: category.name, config: row ? fromConfigRow(row) : null };
      }),
    }, { headers: privateHeaders });
  } catch (cause) {
    if (cause instanceof Error && cause.message === "categories unavailable") return unavailable();
    return organizerFailure(cause);
  }
}

export async function PUT(request: Request, context: Context) {
  // Checked before any identity or storage work, so a forged cross-site write costs nothing.
  if (!sameOrigin(request)) return organizerError("Open this action from the application.", 403);
  const eventId = eventIdFrom((await context.params).eventId);
  if (!eventId) return organizerError("Invalid event identifier.", 400);
  try {
    const user = await requireUser();
    await requireOrganizerAccess(user.id, eventId);
    let body: unknown;
    try { body = await request.json(); } catch { return organizerError("Send a valid race configuration.", 400); }
    const categoryId = (body as Record<string, unknown> | null)?.categoryId;
    if (typeof categoryId !== "number") return organizerError("Choose a category for this configuration.", 422);

    // The category must belong to this event; otherwise an organizer could reconfigure another race.
    const categories = await eventCategories(eventId);
    if (!categories.some((category) => category.id === categoryId)) return organizerNotFound();

    const config = parseStravaRaceConfig(categoryId, body);
    const written = await getSupabaseAdmin().from("strava_race_configs")
      .upsert(toConfigRow(config), { onConflict: "category_id" });
    if (written.error) return unavailable();
    return Response.json({ config }, { headers: privateHeaders });
  } catch (cause) {
    if (cause instanceof RaceConfigError) return organizerError(cause.message, 422);
    if (cause instanceof Error && cause.message === "categories unavailable") return unavailable();
    return organizerFailure(cause);
  }
}
