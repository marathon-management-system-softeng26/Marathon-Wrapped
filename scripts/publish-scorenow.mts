import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  executeScoreNowPublication,
  type LegacyScoreNowRow,
  type ScoreNowPublicationAdapter,
  type ScoreNowPublicationPlan,
  type ScoreNowPublicationRow,
  type ScoreNowPublicationRun,
} from "../lib/scorenow/publication.ts";

const projectRef = "anbnuegocddoowagqmxw";
const configuredRef = process.env.SUPABASE_DEMO_PROJECT_REF;
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const args = new Set(process.argv.slice(2));

if ([...args].some((argument) => argument !== "--publish")) throw new Error("Usage: npm run publish:scorenow -- [--publish]");
if (configuredRef !== projectRef || !supabaseUrl || new URL(supabaseUrl).hostname !== `${projectRef}.supabase.co`) {
  throw new Error(`Refusing ScoreNow publication: configure the dedicated ${projectRef} project explicitly.`);
}
if (!serviceKey) throw new Error("Refusing ScoreNow publication: a server-only Supabase key is required.");

function databaseError(context: string, error: { message: string } | null) {
  if (error) throw new Error(`${context}: ${error.message}`);
}

class SupabasePublicationAdapter implements ScoreNowPublicationAdapter {
  private readonly db: SupabaseClient;

  constructor(db: SupabaseClient) {
    this.db = db;
  }

  async getEvent() {
    const { data, error } = await this.db
      .from("events")
      .select("id,scorenow_competition_id,scorenow_race_id")
      .eq("id", 1)
      .single();
    databaseError("Could not read event 1", error);
    return {
      id: Number(data!.id),
      competitionId: data!.scorenow_competition_id === null ? null : Number(data!.scorenow_competition_id),
      raceId: data!.scorenow_race_id === null ? null : Number(data!.scorenow_race_id),
    };
  }

  async countSourceRows() {
    const { count, error } = await this.db
      .from("scorenow_results")
      .select("*", { count: "exact", head: true })
      .eq("competition_id", 19723)
      .eq("race_id", 308);
    databaseError("Could not count ScoreNow source rows", error);
    if (count === null) throw new Error("ScoreNow source count was unavailable.");
    return count;
  }

  async fetchSourceRows(offset: number, limit: number) {
    const { data, error } = await this.db
      .from("scorenow_results")
      .select("competition_id,race_id,source_event_id,source_uid,race_name,race_date,category,position,bib_number,runner_name,result_status,official_time,official_time_ms,source_category,category_rank,category_total,gender,gender_rank,gender_total,checkpoints,detail_url,source_url,scraped_at")
      .eq("competition_id", 19723)
      .eq("race_id", 308)
      .order("source_uid", { ascending: true })
      .range(offset, offset + limit - 1);
    databaseError(`Could not fetch ScoreNow source rows at offset ${offset}`, error);
    return (data ?? []) as LegacyScoreNowRow[];
  }

  async findRun(digest: string): Promise<ScoreNowPublicationRun | null> {
    const { data, error } = await this.db
      .from("scorenow_import_runs")
      .select("id,manifest_digest,published_at")
      .eq("event_id", 1)
      .eq("manifest_digest", digest)
      .maybeSingle();
    databaseError("Could not inspect an existing ScoreNow publication run", error);
    if (!data) return null;
    return { id: String(data.id), digest: String(data.manifest_digest), publishedAt: data.published_at as string | null };
  }

  async createRun(plan: ScoreNowPublicationPlan): Promise<ScoreNowPublicationRun> {
    const { data, error } = await this.db
      .from("scorenow_import_runs")
      .insert({
        event_id: 1,
        competition_id: 19723,
        race_id: 308,
        manifest_digest: plan.digest,
        parser_version: "legacy-publication-v1",
        manifest: plan.manifest,
        missing_details_reviewed: true,
        identity_changes_reviewed: true,
      })
      .select("id,manifest_digest,published_at")
      .single();
    databaseError("Could not create the ScoreNow publication run", error);
    return { id: String(data!.id), digest: String(data!.manifest_digest), publishedAt: data!.published_at as string | null };
  }

  async ensurePages(runId: string, pages: ScoreNowPublicationPlan["pages"]) {
    const { error } = await this.db.from("scorenow_import_pages").upsert(
      pages.map((page) => ({ run_id: runId, ...page })),
      { onConflict: "run_id,distance,page_number" },
    );
    databaseError("Could not record ScoreNow logical pages", error);
  }

  async stageRows(runId: string, digest: string, rows: ScoreNowPublicationRow[]) {
    const { data, error } = await this.db.rpc("stage_scorenow_import_rows", {
      p_run_id: runId,
      p_manifest_digest: digest,
      p_rows: rows,
    });
    databaseError("Could not stage ScoreNow publication rows", error);
    if (!Number.isSafeInteger(data)) throw new Error("ScoreNow staging returned an invalid acknowledgement.");
    return data as number;
  }

  async configureRealEventSource() {
    const { data, error } = await this.db
      .from("events")
      .update({ scorenow_competition_id: 19723, scorenow_race_id: 308 })
      .eq("id", 1)
      .eq("scorenow_competition_id", 999001)
      .eq("scorenow_race_id", 999002)
      .select("id");
    databaseError("Could not configure event 1 for the real ScoreNow source", error);
    return data?.length === 1;
  }

  async publishRun(runId: string) {
    const { data, error } = await this.db.rpc("publish_scorenow_import", { p_run_id: runId });
    databaseError("Could not publish the ScoreNow run", error);
    return data as { eventId: number; counts: { "5K": number; "10K": number } };
  }
}

const db = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const result = await executeScoreNowPublication(new SupabasePublicationAdapter(db), {
  projectRef: configuredRef,
  publish: args.has("--publish"),
});

console.log(JSON.stringify({
  mode: result.mode,
  projectRef,
  eventId: 1,
  competitionId: 19723,
  raceId: 308,
  digest: result.plan.digest,
  counts: { "5K": 5_987, "10K": 3_995, total: result.plan.rows.length },
  logicalPages: result.plan.pages.length,
  stageBatches: result.plan.batches.length,
  runId: result.runId,
}, null, 2));
