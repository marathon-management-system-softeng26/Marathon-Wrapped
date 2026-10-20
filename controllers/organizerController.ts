import "server-only";
import { requireOrganizerAccess } from "@/lib/auth/access";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { validateHeroDraft } from "@/lib/heroValidation";
import { requireRunnerAccess, AccessDeniedError } from "@/lib/auth/access";

export async function getHeroDraft(
  userId: string,
  eventId: number,
  runnerId: string,
) {
  await requireOrganizerAccess(userId, eventId);
  await requireRunnerAccess(userId, runnerId);
  const db = getSupabaseAdmin();
  const row = await db
    .from("runners")
    .select("name,bib_number,date_of_birth,gender,parental_consent,category_id")
    .eq("id", runnerId)
    .maybeSingle();
  if (row.error) throw new Error("Runner unavailable");
  if (!row.data) throw new AccessDeniedError();
  const category = await db
    .from("categories")
    .select("name,event_id")
    .eq("id", row.data.category_id)
    .single();
  if (category.error) throw new Error("Category unavailable");
  if (category.data.event_id !== eventId) throw new AccessDeniedError();
  const [chip, splits, metrics, photos] = await Promise.all([
    db
      .from("chip_results")
      .select("finisher,start_status,start_time,finish_time")
      .eq("runner_id", runnerId)
      .maybeSingle(),
    db
      .from("chip_splits")
      .select("km_marker,split_seconds")
      .eq("runner_id", runnerId)
      .order("km_marker"),
    db
      .from("strava_metrics")
      .select(
        "avg_heartrate,max_heartrate,elevation_gain_m,calories,avg_cadence,data_source",
      )
      .eq("runner_id", runnerId)
      .maybeSingle(),
    db
      .from("fotoyu_photos")
      .select("photo_url,photographer,captured_km,captured_at")
      .eq("bib_number", row.data.bib_number),
  ]);
  if (chip.error || splits.error || metrics.error || photos.error)
    throw new Error("Result unavailable");
  if (metrics.data && metrics.data.data_source !== "demo")
    throw new Error(
      "Live provider records cannot be edited through demo management.",
    );
  const { category_id, ...identity } = row.data;
  void category_id;
  return {
    ...identity,
    category: category.data.name,
    result: chip.data,
    enrichment: {
      metrics: metrics.data
        ? {
            avg_heartrate: metrics.data.avg_heartrate,
            max_heartrate: metrics.data.max_heartrate,
            elevation_gain_m:
              metrics.data.elevation_gain_m === null
                ? null
                : Number(metrics.data.elevation_gain_m),
            calories: metrics.data.calories,
            avg_cadence: metrics.data.avg_cadence,
          }
        : null,
      photos: photos.data,
    },
    splits: splits.data.map((split) => ({
      ...split,
      split_seconds: Number(split.split_seconds),
    })),
  };
}

export class OrganizerSaveError extends Error {
  status: number;
  constructor(code: string) {
    const conflict = code === "23505";
    super(
      conflict
        ? "That BIB is already assigned. Use a different BIB."
        : "The save was rejected. Check the BIB, eligibility, category, timing and splits.",
    );
    this.name = "OrganizerSaveError";
    this.status = conflict ? 409 : 422;
  }
}
export async function saveHeroRunner(
  userId: string,
  eventId: number,
  runnerId: string | null,
  input: unknown,
): Promise<{ runner_id: string }> {
  await requireOrganizerAccess(userId, eventId);
  const draft = validateHeroDraft(input, process.env.SUPABASE_URL);
  const { data, error } = await getSupabaseAdmin().rpc("save_hero_runner", {
    p_event_id: eventId,
    p_runner_id: runnerId,
    p_draft: draft,
  });
  if (error) {
    if (
      ["23505", "23514", "23503", "22023", "P0001", "P0002"].includes(
        error.code,
      )
    )
      throw new OrganizerSaveError(error.code);
    throw new Error("Runner management is unavailable.");
  }
  if (typeof data !== "string")
    throw new Error("Runner management returned an invalid response.");
  return { runner_id: data };
}

export async function getEventResults(userId: string, eventId: number) {
  await requireOrganizerAccess(userId, eventId);
  const db = getSupabaseAdmin();
  const categories = await db
    .from("categories")
    .select("id,name,distance_km")
    .eq("event_id", eventId);
  if (categories.error) throw new Error("Event results are unavailable.");
  if (!categories.data.length) return [];
  const runners = await db
    .from("runners")
    .select("id,bib_number,name,category_id")
    .in(
      "category_id",
      categories.data.map((c) => c.id),
    )
    .order("bib_number");
  if (runners.error) throw new Error("Event results are unavailable.");
  if (!runners.data.length) return [];
  const results = await db
    .from("runner_wrapped")
    .select(
      "runner_id,start_status,finisher,elapsed_seconds,avg_pace_sec_km,category_rank,overall_rank",
    )
    .in(
      "runner_id",
      runners.data.map((r) => r.id),
    );
  if (results.error) throw new Error("Event results are unavailable.");
  return runners.data.map((runner) => {
    const category = categories.data.find((c) => c.id === runner.category_id)!;
    const result = results.data.find((r) => r.runner_id === runner.id);
    return {
      runner_id: runner.id,
      bib_number: runner.bib_number,
      name: runner.name,
      category: category.name,
      distance_km: Number(category.distance_km),
      status: !result
        ? "unavailable"
        : result.start_status === "dns"
          ? "dns"
          : result.finisher
            ? "finisher"
            : "dnf",
      elapsed_seconds: result?.elapsed_seconds ?? null,
      avg_pace_sec_km: result?.avg_pace_sec_km ?? null,
      category_rank: result?.category_rank ?? null,
      overall_rank: result?.overall_rank ?? null,
    };
  });
}
