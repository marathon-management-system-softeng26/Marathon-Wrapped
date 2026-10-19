import type { RunnerChipInput } from "@/lib";
import supabase from "@/lib/supabaseServer";

export async function getRunnerChipInput(runnerId: string): Promise<RunnerChipInput | null> {
    if (!runnerId) {
        throw new Error("Runner ID is required.");
    }

    const {error, data} = await supabase.from("runner_wrapped").select(`runner_id, bib_number, name, gender, age,
    event, category, distance_km, start_status,
    elapsed_seconds, avg_pace_sec_km,
    category_rank, overall_rank, category_percentile,
    finisher`).eq("runner_id", runnerId).maybeSingle();

    if (error) {
        console.error("Error fetching runner chip input:", error);
        throw error;
    }

    if (!data) {
        console.warn("No data found for runner ID:", runnerId);
        return null;
    }

    const {error: splitsError, data: splitsData} = await supabase.from("chip_splits").select(`km_marker, split_seconds`).eq("runner_id", runnerId).order("km_marker", {ascending: true});

    if (splitsError) {
        console.error("Error fetching runner splits:", splitsError);
        throw splitsError;
    }

    const runnerChipInput: RunnerChipInput = {
        runner_id: data.runner_id,
        bib_number: data.bib_number,
        name: data.name,
        gender: data.gender,
        age: data.age,
        event: data.event,
        category: data.category,
        distance_km: data.distance_km,
        start_status: data.start_status,
        elapsed_seconds: data.elapsed_seconds,
        avg_pace_sec_km: data.avg_pace_sec_km,
        category_rank: data.category_rank,
        overall_rank: data.overall_rank,
        category_percentile: data.category_percentile,
        finisher: data.finisher,
        splits: splitsData || [],
    };

    return runnerChipInput;

}