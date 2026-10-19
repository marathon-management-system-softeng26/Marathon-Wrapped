import "server-only";
import { requireOrganizerAccess } from "@/lib/auth/access";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { validateHeroDraft } from "@/lib/heroValidation";

export class OrganizerSaveError extends Error {
  status: number;
  constructor(code: string) {
    const conflict = code === "23505";
    super(conflict ? "That BIB is already assigned. Use a different BIB." : "The save was rejected. Check the BIB, eligibility, category, timing and splits.");
    this.name = "OrganizerSaveError"; this.status = conflict ? 409 : 422;
  }
}
export async function saveHeroRunner(userId: string, eventId: number, runnerId: string | null, input: unknown): Promise<{ runner_id: string }> {
  await requireOrganizerAccess(userId, eventId);
  const draft = validateHeroDraft(input);
  const { data, error } = await getSupabaseAdmin().rpc("save_hero_runner", { p_event_id: eventId, p_runner_id: runnerId, p_draft: draft });
  if (error) {
    if (["23505", "23514", "23503", "22023", "P0001", "P0002"].includes(error.code)) throw new OrganizerSaveError(error.code);
    throw new Error("Runner management is unavailable.");
  }
  if (typeof data !== "string") throw new Error("Runner management returned an invalid response.");
  return { runner_id: data };
}

export async function getEventResults(userId: string, eventId: number) {
  await requireOrganizerAccess(userId, eventId);
  const db = getSupabaseAdmin();
  const categories = await db.from("categories").select("id,name,distance_km").eq("event_id", eventId);
  if (categories.error) throw new Error("Event results are unavailable.");
  if (!categories.data.length) return [];
  const runners = await db.from("runners").select("id,bib_number,name,category_id").in("category_id", categories.data.map(c => c.id)).order("bib_number");
  if (runners.error) throw new Error("Event results are unavailable.");
  if (!runners.data.length) return [];
  const results = await db.from("runner_wrapped").select("runner_id,start_status,finisher,elapsed_seconds,avg_pace_sec_km,category_rank,overall_rank")
    .in("runner_id", runners.data.map(r => r.id));
  if (results.error) throw new Error("Event results are unavailable.");
  return runners.data.map(runner => {
    const category = categories.data.find(c => c.id === runner.category_id)!;
    const result = results.data.find(r => r.runner_id === runner.id);
    return { runner_id: runner.id, bib_number: runner.bib_number, name: runner.name, category: category.name, distance_km: Number(category.distance_km),
      status: !result ? "unavailable" : result.start_status === "dns" ? "dns" : result.finisher ? "finisher" : "dnf",
      elapsed_seconds: result?.elapsed_seconds ?? null, avg_pace_sec_km: result?.avg_pace_sec_km ?? null,
      category_rank: result?.category_rank ?? null, overall_rank: result?.overall_rank ?? null };
  });
}
