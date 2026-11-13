import "server-only";
import { AccessDeniedError } from "@/lib/auth/access";
import { safeCandidate, type CandidateActivity, type CandidateRow } from "@/lib/strava/candidate";
import { isStravaWrappedSnapshotV1 } from "@/lib/strava/projection";
import { loadStravaRunnerAttachment, stravaRpc } from "@/lib/strava/store";
import { getSupabaseAdmin } from "@/lib/supabaseServer";
import type { Photo, StravaFirstWrappedPayload, WrappedRegistration } from "@/lib/wrappedPayload";

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

async function loadConfirmation(
  userId: string, generation: string, runnerId: string, attachmentId: string,
): Promise<StravaFirstWrappedPayload> {
  const current = await stravaRpc<{
    state: SimpleState;
    registration: WrappedRegistration;
    athlete_id: string | null;
    candidates: (CandidateRow & { strava_activities: CandidateActivity })[];
  } | null>("strava_wrapped_confirmation", {
    p_user: userId, p_runner: runnerId, p_generation: generation, p_attachment: attachmentId,
  });
  if (!current) throw new AccessDeniedError();
  const { state, registration, athlete_id } = current;
  if (state !== "no_match" || !athlete_id) return { state, registration };

  const candidates = current.candidates.flatMap((row) => safeCandidate(row, row.strava_activities, athlete_id) ?? []);
  return candidates.length ? { state: "needs_confirmation", registration, candidates } : { state, registration };
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
  if (!selection) return loadConfirmation(userId, generation, runnerId, attachment.attachment_id);
  const snapshot = selection.strava_wrapped_snapshots[0];
  if (!snapshot || snapshot.status === "building") return state("building");
  if (snapshot.status !== "ready" || !isStravaWrappedSnapshotV1(snapshot.payload) || snapshot.payload.runner.id !== runnerId) {
    return state("failed");
  }
  const photos = await loadPhotos(db, registration.runner.bibNumber);

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
  if (currentAttachment.attachment_id !== attachment.attachment_id || currentSelection?.activity_id !== selection.activity_id ||
      currentSnapshot?.build_id !== snapshot.build_id || currentSnapshot.status !== snapshot.status) return state("importing");
  return {
    state: "ready", registration: currentRegistration, snapshot: snapshot.payload,
    photos: currentRegistration.runner.bibNumber === registration.runner.bibNumber ? photos : [],
  };
}
