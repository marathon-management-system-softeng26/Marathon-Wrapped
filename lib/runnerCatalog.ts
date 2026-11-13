import "server-only";
import { safeCandidate, type CandidateActivity, type CandidateRow } from "./strava/candidate";
import { inactiveStravaConnectionState, isReadyWrappedSnapshot, loadStoredStravaConnection } from "./stravaWrappedService";
import { getSupabaseAdmin } from "./supabaseServer";
import type { StravaFirstWrappedPayload } from "./wrappedPayload";

type Database = ReturnType<typeof getSupabaseAdmin>;
type Event = { id: number; name: string };
type Registration = { id: string; name: string; bib_number: string | null; event: string; category: string };
type RunnerRow = Pick<Registration, "id" | "name" | "bib_number"> & {
  categories: { name: string; events: { name: string } };
};
const defaultAction = {
  setup_required: "connect",
  authorizing: "check_authorization",
  importing: "importing",
  needs_confirmation: "confirm",
  no_match: "review_import",
  building: "building",
  failed: "failed",
  reauth_required: "reauthorize",
  ready: "view",
} as const satisfies Record<StravaFirstWrappedPayload["state"], string>;
type WorkflowState = keyof typeof defaultAction;
type PrimaryAction = (typeof defaultAction)[WorkflowState] | "attach";
export type CatalogRunner = Registration & { workflowState: WorkflowState; primaryAction: PrimaryAction };
export type RunnerCatalog = { runners: CatalogRunner[]; events: Event[] };

function read<T>({ data, error }: { data: T | null; error: unknown }): T {
  if (error || data === null) throw new Error("Your races are temporarily unavailable.");
  return data;
}

async function loadWorkflows(db: Database, userId: string, runnerIds: string[]) {
  const states = new Map<string, WorkflowState | "attach">();
  const connection = await loadStoredStravaConnection(db, userId);
  const inactive = inactiveStravaConnectionState(connection);
  if (!connection) return states;

  const { generation, athlete_id: athleteId } = connection;
  if (inactive) {
    const attempts = read(await db.from("strava_oauth_attempts").select("runner_id")
      .eq("user_id", userId).eq("generation", generation).in("runner_id", runnerIds)
      .in("status", ["pending", "processing"]).gt("expires_at", new Date().toISOString()));
    const authorizing = new Set(attempts.map(({ runner_id }) => runner_id));
    for (const id of runnerIds) states.set(id, authorizing.has(id) ? "authorizing" : inactive);
    return states;
  }

  const [attachmentResult, selectionResult, candidateResult, jobResult] = await Promise.all([
    db.from("strava_runner_attachments").select("runner_id,attachment_id")
      .eq("user_id", userId).eq("generation", generation).in("runner_id", runnerIds).eq("status", "active"),
    db.from("strava_runner_activities").select("runner_id,strava_wrapped_snapshots(status,payload)")
      .eq("user_id", userId).eq("generation", generation).in("runner_id", runnerIds).eq("strava_wrapped_snapshots.version", 1)
      .returns<{ runner_id: string; strava_wrapped_snapshots: { status: string; payload: unknown }[] }[]>(),
    db.from("strava_activity_candidates")
      .select("runner_id,activity_id,match_status,reason,summary,strava_activities(id:activity->>id,athleteId:activity->>athleteId,sportType:activity->>sportType,startDate:activity->>startDate,distanceMeters:activity->distanceMeters,gpsAvailable:activity->gpsAvailable)")
      .eq("user_id", userId).eq("generation", generation).in("runner_id", runnerIds)
      .in("match_status", ["auto_match", "needs_confirmation"])
      .returns<(CandidateRow & { runner_id: string; strava_activities: CandidateActivity })[]>(),
    db.from("strava_jobs").select("status,attachment_fences")
      .eq("user_id", userId).eq("generation", generation).in("kind", ["backfill", "activity", "webhook"])
      .in("status", ["pending", "processing", "failed"])
      .order("status", { ascending: false })
      .returns<{ status: string; attachment_fences: Record<string, string> }[]>(),
  ]);
  const attachments = new Map(read(attachmentResult).map((row) => [row.runner_id, row.attachment_id]));
  const selections = new Map(read(selectionResult).map((row) => [row.runner_id, row.strava_wrapped_snapshots[0]]));
  const candidates = new Set(read(candidateResult).flatMap((row) =>
    athleteId && safeCandidate(row, row.strava_activities, athleteId) ? [row.runner_id] : []));
  const importStates = new Map<string, "importing" | "failed">();
  for (const job of read(jobResult)) {
    for (const [runnerId, fence] of Object.entries(job.attachment_fences)) {
      if (attachments.get(runnerId) === fence && importStates.get(runnerId) !== "importing") {
        importStates.set(runnerId, job.status === "failed" ? "failed" : "importing");
      }
    }
  }

  for (const id of runnerIds) {
    if (!attachments.has(id)) {
      states.set(id, "attach");
    } else if (selections.has(id)) {
      const snapshot = selections.get(id);
      const state = !snapshot || snapshot.status === "building" ? "building" : isReadyWrappedSnapshot(snapshot, id) ? "ready" : "failed";
      states.set(id, state);
    } else {
      states.set(id, importStates.get(id) ?? (candidates.has(id) ? "needs_confirmation" : "no_match"));
    }
  }
  return states;
}

export async function getRunnerCatalog(userId: string): Promise<RunnerCatalog> {
  const db = getSupabaseAdmin();
  const [own, organizer] = await Promise.all([
    db.from("runner_access").select("runners(id,name,bib_number,categories(name,events(name)))")
      .eq("user_id", userId).returns<{ runners: RunnerRow }[]>(),
    db.from("organizer_access").select("events(id,name)").eq("user_id", userId).returns<{ events: Event }[]>(),
  ]);
  const owned = read(own).map(({ runners }) => runners).sort((a, b) => a.name.localeCompare(b.name));
  const events = read(organizer).map(({ events: { id, name } }) => ({ id, name }));
  if (!owned.length) return { runners: [], events };

  const states = await loadWorkflows(db, userId, owned.map(({ id }) => id));
  const runners = owned.map(({ id, name, bib_number, categories }): CatalogRunner => {
    const identity = { id, name, bib_number, event: categories.events.name, category: categories.name };
    const state = states.get(id) ?? "setup_required";
    if (state === "attach") return { ...identity, workflowState: "setup_required", primaryAction: "attach" };
    return { ...identity, workflowState: state, primaryAction: defaultAction[state] };
  });
  return { runners, events };
}
