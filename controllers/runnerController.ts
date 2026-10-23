import "server-only";
import type { RunnerChipInput } from "@/lib/types";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import { InvalidRunnerDataError, isRunnerId, validateRunnerChipInput } from "@/lib/runnerValidation";

export async function getRunnerSummary(runnerId: string) {
  if (!isRunnerId(runnerId)) throw new InvalidRunnerDataError();
  const { data, error } = await getSupabaseAdmin().from("runners")
    .select("id,name,bib_number").eq("id", runnerId).maybeSingle();
  if (error) throw new Error("Runner lookup is unavailable.");
  return data ? { runner_id: data.id as string, name: data.name as string, bib_number: data.bib_number as string | null } : null;
}

/** Internal repository: callers must verify runner access first. */
export async function getRunnerChipInput(runnerId: string): Promise<RunnerChipInput | null> {
  if (!isRunnerId(runnerId)) throw new InvalidRunnerDataError();
  const db = getSupabaseAdmin();
  const { data, error } = await db.from("runner_wrapped").select(
    "runner_id,bib_number,name,gender,age,event,category,distance_km,start_status,elapsed_seconds,avg_pace_sec_km,category_rank,overall_rank,category_percentile,finisher"
  ).eq("runner_id", runnerId).maybeSingle();
  if (error) throw new Error("Chip results are unavailable.");
  if (!data) return null;
  const [timing, splits] = await Promise.all([
    db.from("chip_results").select("start_time,finish_time").eq("runner_id", runnerId).maybeSingle(),
    db.from("chip_splits").select("km_marker,split_seconds").eq("runner_id", runnerId).order("km_marker", { ascending: true }),
  ]);
  if (timing.error || splits.error) throw new Error("Chip details are unavailable.");
  if (!timing.data) throw new InvalidRunnerDataError();
  return validateRunnerChipInput({ ...data, ...timing.data, splits: splits.data ?? [] });
}
