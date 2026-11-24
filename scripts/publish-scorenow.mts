import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  executeScoreNowPublication,
  type LegacyScoreNowRow,
  type ScoreNowPublicationAdapter,
  type ScoreNowPublicationPlan,
  type ScoreNowPublicationRow,
  type ScoreNowPublicationRun,
  type ScoreNowPublishedIdentity,
} from "../lib/scorenow/publication.ts";

const projectRef = "anbnuegocddoowagqmxw";
const configuredRef = process.env.SUPABASE_DEMO_PROJECT_REF;
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const args = new Set(process.argv.slice(2));

if ([...args].some((argument) => !["--publish", "--review-identity-changes"].includes(argument))) {
  throw new Error("Usage: npm run publish:scorenow -- [--publish] [--review-identity-changes]");
}
if (args.has("--review-identity-changes") && !args.has("--publish")) {
  throw new Error("--review-identity-changes requires --publish.");
}
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

  async listPublishedIdentities(): Promise<ScoreNowPublishedIdentity[]> {
    const countIdentities = async () => {
      const { count, error } = await this.db
        .from("official_race_results")
        .select("*", { count: "exact", head: true })
        .eq("event_id", 1);
      databaseError("Could not count published identities", error);
      if (count === null) throw new Error("Published identity count was unavailable.");
      return count;
    };
    const initialCount = await countIdentities();
    const identities: ScoreNowPublishedIdentity[] = [];
    for (let offset = 0; offset < initialCount; offset += 1_000) {
      const expected = Math.min(1_000, initialCount - offset);
      const { data, error } = await this.db
        .from("official_race_results")
        .select("bib,name,distance,source_uid")
        .eq("event_id", 1)
        .order("bib", { ascending: true })
        .range(offset, offset + expected - 1);
      databaseError(`Could not read published identities at offset ${offset}`, error);
      if (data?.length !== expected) throw new Error(`Published identity scan returned a short page at offset ${offset}.`);
      for (const row of data) {
        if (row.distance !== "5K" && row.distance !== "10K") throw new Error("Published identity has an invalid distance.");
        identities.push({ bib: String(row.bib), name: String(row.name), distance: row.distance, sourceUid: row.source_uid as string | null });
      }
    }
    if (await countIdentities() !== initialCount) throw new Error("Published identities changed during review.");
    return identities;
  }

  async acquireRun(plan: ScoreNowPublicationPlan, identityChangesReviewed: boolean): Promise<ScoreNowPublicationRun> {
    const { data, error } = await this.db
      .from("scorenow_import_runs")
      .upsert({
        event_id: 1,
        competition_id: 19723,
        race_id: 308,
        manifest_digest: plan.digest,
        parser_version: "legacy-publication-v1",
        manifest: plan.manifest,
        missing_details_reviewed: true,
        identity_changes_reviewed: identityChangesReviewed,
      }, { onConflict: "event_id,manifest_digest" })
      .select("id,manifest_digest,published_at")
      .single();
    databaseError("Could not acquire the ScoreNow publication run", error);
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
    if (data?.length === 1) return true;
    const event = await this.getEvent();
    return event.competitionId === 19723 && event.raceId === 308;
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
  reviewIdentityChanges: args.has("--review-identity-changes"),
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
  identityReview: result.identityReview,
}, null, 2));
