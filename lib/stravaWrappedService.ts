import "server-only";
import { AccessDeniedError } from "@/lib/auth/access";
import { safeCandidate, type CandidateActivity, type CandidateRow } from "@/lib/strava/candidate";
import { isStravaWrappedSnapshotV1 } from "@/lib/strava/projection";
import { loadStravaRunnerAttachment } from "@/lib/strava/store";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import type { Photo, StravaCandidate, StravaFirstWrappedPayload, WrappedRegistration } from "@/lib/wrappedPayload";

type Database = ReturnType<typeof getSupabaseAdmin>;
type SimpleState = Exclude<StravaFirstWrappedPayload["state"], "needs_confirmation" | "ready">;
type Connection = {
  generation: string;
  status: string;
  athlete_id: string | null;
  credentials_uncertain: boolean;
  granted_scopes: string[];
};
type SnapshotRow = { build_id: string; status: string; payload?: unknown };

function read<T>({ data, error }: { data: T; error: unknown }): T {
  if (error) throw new Error("Wrapped storage is temporarily unavailable.");
  return data;
}

async function loadRegistration(db: Database, userId: string, runnerId: string): Promise<WrappedRegistration> {
  const row = read(await db.from("runner_access")
    .select("runners(id,name,bib_number,categories(name,events(name,event_date)))")
    .eq("user_id", userId).eq("runner_id", runnerId)
    .maybeSingle<{
      runners: { id: string; name: string; bib_number: string | null;
        categories: { name: string; events: { name: string; event_date: string } } };
    }>());
  if (!row) throw new AccessDeniedError();
  const { id, name, bib_number, categories } = row.runners;
  return {
    runner: { id, name, bibNumber: bib_number },
    event: { name: categories.events.name, date: categories.events.event_date, category: categories.name },
  };
}

async function loadConnection(db: Database, userId: string): Promise<Connection | null> {
  return read(await db.from("strava_connections")
    .select("generation,status,athlete_id,credentials_uncertain,granted_scopes")
    .eq("user_id", userId).maybeSingle<Connection>());
}

function inactiveState(connection: Connection | null): SimpleState | null {
  if (connection?.status === "reauth_required" || connection?.credentials_uncertain) return "reauth_required";
  if (connection?.status !== "active") return "setup_required";
  if (!connection.athlete_id || !connection.granted_scopes.includes("activity:read_all")) return "reauth_required";
  return null;
}

async function loadSelection(db: Database, userId: string, generation: string, runnerId: string, includePayload: boolean) {
  const fields = includePayload ? "activity_id,strava_wrapped_snapshots(build_id,status,payload)" : "activity_id,strava_wrapped_snapshots(build_id,status)";
  return read(await db.from("strava_runner_activities").select(fields)
    .eq("user_id", userId).eq("generation", generation).eq("runner_id", runnerId)
    .eq("strava_wrapped_snapshots.version", 1)
    .maybeSingle<{ activity_id: string; strava_wrapped_snapshots: SnapshotRow[] }>());
}

async function loadCandidates(db: Database, userId: string, generation: string, runnerId: string, athleteId: string) {
  const candidates: StravaCandidate[] = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const rows = read(await db.from("strava_activity_candidates")
      .select(`activity_id,match_status,reason,summary,strava_activities(
        id:activity->>id,athleteId:activity->>athleteId,sportType:activity->>sportType,
        startDate:activity->>startDate,distanceMeters:activity->distanceMeters,gpsAvailable:activity->gpsAvailable
      )`)
      .eq("user_id", userId).eq("generation", generation).eq("runner_id", runnerId)
      .in("match_status", ["auto_match", "needs_confirmation"])
      .order("activity_id").range(offset, offset + pageSize - 1)
      .overrideTypes<(CandidateRow & { strava_activities: CandidateActivity | null })[], { merge: false }>()) ?? [];
    for (const row of rows) {
      const activity = row.strava_activities;
      const candidate = activity && safeCandidate(row, activity, athleteId);
      if (candidate) candidates.push(candidate);
    }
    if (rows.length < pageSize) return candidates;
  }
}

async function loadPhotos(db: Database, bib: string | null): Promise<Photo[]> {
  if (bib === null) return [];
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const query = db.from("fotoyu_photos")
      .select("id,bib_number,photo_url,photographer,captured_km,captured_at")
      .eq("bib_number", bib).order("captured_at", { ascending: true })
      .retry(false).abortSignal(controller.signal);
    const deadline = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(null);
      }, 1200);
    });
    const result = await Promise.race([query, deadline]);
    if (!result || result.error) return [];
    return result.data.map(({ id, bib_number, photo_url, photographer, captured_km, captured_at }) =>
      ({ id, bib_number, photo_url, photographer, captured_km, captured_at }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export async function getStravaWrappedForUser(userId: string, runnerId: string): Promise<StravaFirstWrappedPayload> {
  const db = getSupabaseAdmin();
  const registration = await loadRegistration(db, userId, runnerId);
  const state = (value: SimpleState): StravaFirstWrappedPayload => ({ state: value, registration });
  const connection = await loadConnection(db, userId);
  const inactive = inactiveState(connection);
  if (!connection || inactive) {
    if (connection) {
      const attempt = read(await db.from("strava_oauth_attempts").select("status")
        .eq("user_id", userId).eq("generation", connection.generation).eq("runner_id", runnerId)
        .in("status", ["pending", "processing"]).gt("expires_at", new Date().toISOString()).limit(1).maybeSingle());
      if (attempt) return state("authorizing");
    }
    return state(inactive ?? "setup_required");
  }

  const { generation, athlete_id: athleteId } = connection;
  const attachment = await loadStravaRunnerAttachment(userId, generation, runnerId);
  if (!attachment) return state("setup_required");
  const selection = await loadSelection(db, userId, generation, runnerId, true);
  const snapshot = selection?.strava_wrapped_snapshots[0];
  let payload: StravaFirstWrappedPayload;
  if (selection) {
    if (!snapshot || snapshot.status === "building") return state("building");
    if (snapshot.status !== "ready" || !isStravaWrappedSnapshotV1(snapshot.payload) || snapshot.payload.runner.id !== runnerId) {
      return state("failed");
    }
    const photos = await loadPhotos(db, registration.runner.bibNumber);
    payload = { state: "ready", registration, snapshot: snapshot.payload, photos };
  } else {
    // Descending status puts both runnable states before failed.
    const jobs = read(await db.from("strava_jobs").select("status")
      .eq("user_id", userId).eq("generation", generation)
      .eq(`attachment_fences->>${runnerId}`, attachment.attachment_id)
      .in("kind", ["backfill", "activity", "webhook"]).in("status", ["pending", "processing", "failed"])
      .order("status", { ascending: false }).limit(1).maybeSingle());
    if (jobs) return state(jobs.status === "failed" ? "failed" : "importing");
    const candidates = await loadCandidates(db, userId, generation, runnerId, athleteId!);
    if (!candidates.length) return state("no_match");
    payload = { state: "needs_confirmation", registration, candidates };
  }

  // A slow optional read must never return data from a detached runner, replaced
  // selection or projection, or a connection that changed during the request.
  const [currentRegistration, currentConnection, currentAttachment, currentSelection] = await Promise.all([
    loadRegistration(db, userId, runnerId),
    loadConnection(db, userId),
    loadStravaRunnerAttachment(userId, generation, runnerId),
    loadSelection(db, userId, generation, runnerId, false),
  ]);
  const currentInactive = inactiveState(currentConnection);
  if (currentInactive) return state(currentInactive);
  if (currentConnection?.generation !== generation || currentConnection.athlete_id !== athleteId) return state("importing");
  if (!currentAttachment) return state("setup_required");
  const currentSnapshot = currentSelection?.strava_wrapped_snapshots[0];
  if (currentAttachment.attachment_id !== attachment.attachment_id || currentSelection?.activity_id !== selection?.activity_id ||
      currentSnapshot?.build_id !== snapshot?.build_id || currentSnapshot?.status !== snapshot?.status) return state("importing");
  if (payload.state === "ready" && currentRegistration.runner.bibNumber !== registration.runner.bibNumber) {
    return { ...payload, registration: currentRegistration, photos: [] };
  }
  return { ...payload, registration: currentRegistration };
}
