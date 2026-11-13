import { createClient } from "@supabase/supabase-js";
import { candidate, photo, registration, runnerId, snapshot } from "./stravaWrapped";

export const ownerId = "aa000000-0000-4000-a000-000000000001";
export const organizerId = "aa000000-0000-4000-a000-000000000002";
const generation = "bb000000-0000-4000-a000-000000000001";
const attachmentId = "cc000000-0000-4000-a000-000000000001";
const athleteId = "1385631729";
const activityId = candidate.activityId;
const scoped = { user_id: ownerId, generation, runner_id: runnerId };

export type TestState = "setup_required" | "authorizing" | "importing" | "needs_confirmation" | "no_match" | "building" | "ready" | "failed" | "reauth_required";

export function wrappedDatabase(state: TestState = "ready", options: {
  photoError?: boolean;
  noPhotos?: boolean;
  noBib?: boolean;
  snapshotPayload?: unknown;
  snapshotVersion?: number;
  invalidCandidate?: boolean;
  unknownCandidateReason?: boolean;
  missingSnapshot?: boolean;
  currentFailedImport?: boolean;
  stalledPhotos?: boolean;
  revokeAccessDuringRead?: boolean;
  changeBibDuringRead?: boolean;
  rebuildDuringRead?: boolean;
  detachDuringRead?: boolean;
  reauthDuringRead?: boolean;
  replaceDuringRead?: boolean;
} = {}) {
  const active = !["setup_required", "authorizing", "reauth_required"].includes(state);
  const selected = ["building", "ready", "failed"].includes(state);
  const storedSnapshot = {
    ...scoped, activity_id: activityId, version: options.snapshotVersion ?? 1, build_id: "build-1",
    status: state, payload: state === "ready" ? options.snapshotPayload ?? snapshot : null,
    error_code: state === "failed" ? "private_provider_failure" : null,
  };
  const registrationRow = {
    id: runnerId, name: registration.runner.name, bib_number: options.noBib ? null : registration.runner.bibNumber,
    categories: { name: registration.event.category, events: { name: registration.event.name, event_date: registration.event.date } },
  };
  const candidateRow = {
    ...scoped, activity_id: activityId, match_status: "needs_confirmation",
    reason: options.unknownCandidateReason ? "private_provider_reason" : "missing_start_location",
    summary: { startDate: "2027-08-16T23:00:00Z", distanceMeters: 5100, gpsAvailable: true, coordinates: [-6.1, 106.5] },
    strava_activities: { id: activityId, athleteId: options.invalidCandidate ? "999" : athleteId, sportType: "Run" },
  };
  const connection = {
    user_id: ownerId, generation, status: active ? "active" : state === "reauth_required" ? "reauth_required" : "disconnected",
    athlete_id: active ? athleteId : null, credentials_uncertain: false, granted_scopes: ["activity:read_all"],
  };
  const tables: Record<string, Record<string, unknown>[]> = {
    runner_access: [{ user_id: ownerId, runner_id: runnerId, runners: registrationRow }],
    organizer_access: [{ user_id: organizerId, event_id: 1 }],
    strava_connections: [connection],
    strava_oauth_attempts: state === "authorizing" ? [
      { ...scoped, status: "pending", expires_at: "2999-01-01T00:00:00Z" },
    ] : [{ ...scoped, status: "pending", expires_at: "2000-01-01T00:00:00Z" }],
    strava_runner_attachments: active ? [{ ...scoped, status: "active", attachment_id: attachmentId }] : [],
    strava_runner_activities: selected ? [{
      ...scoped, activity_id: activityId, strava_wrapped_snapshots: options.missingSnapshot ? [] : [storedSnapshot],
    }] : [],
    strava_wrapped_snapshots: selected && !options.missingSnapshot ? [storedSnapshot] : [],
    strava_activity_candidates: state === "needs_confirmation" ? [candidateRow] : [],
    strava_jobs: [
      { user_id: ownerId, generation, kind: "backfill", status: "failed",
        attachment_fences: { [runnerId]: "obsolete-attachment" } },
      { user_id: ownerId, generation, kind: "backfill", status: "pending",
        attachment_fences: { [runnerId]: "obsolete-attachment" } },
      ...(state === "importing" ? [
        { user_id: ownerId, generation, kind: "backfill", status: "pending", attachment_fences: { [runnerId]: attachmentId } },
      ] : []),
      ...(options.currentFailedImport ? [
        { user_id: ownerId, generation, kind: "backfill", status: "failed", attachment_fences: { [runnerId]: attachmentId } },
      ] : []),
    ],
    fotoyu_photos: options.noPhotos ? [] : [{ ...photo, coordinates: [-6.1, 106.5] }],
  };
  const requests: URL[] = [];
  let attachmentReads = 0;
  let connectionReads = 0;
  let selectionReads = 0;
  let registrationReads = 0;
  const client = createClient("https://test.supabase.invalid", "test-server-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input);
      requests.push(url);
      const table = url.pathname.split("/").at(-1)!;
      if (table === "fotoyu_photos" && options.stalledPhotos) return new Promise(() => {});
      if (table === "fotoyu_photos" && options.photoError) {
        return Response.json({ message: "private photo infrastructure detail" }, { status: 403 });
      }
      if (!(table in tables)) return Response.json({ message: `unexpected table: ${table}` }, { status: 400 });
      let rows = tables[table];
      if (table === "runner_access" && ++registrationReads > 1) {
        if (options.revokeAccessDuringRead) rows = [];
        if (options.changeBibDuringRead) rows = [{ user_id: ownerId, runner_id: runnerId, runners: { ...registrationRow, bib_number: "A2002" } }];
      }
      if (table === "strava_runner_attachments" && ++attachmentReads > 1 && options.detachDuringRead) rows = [];
      if (table === "strava_connections" && ++connectionReads > 1 && options.reauthDuringRead) {
        rows = [{ ...connection, status: "reauth_required" }];
      }
      if (table === "strava_runner_activities" && ++selectionReads > 1) {
        if (options.replaceDuringRead) rows = [];
        if (options.rebuildDuringRead) rows = rows.map((row) => ({
          ...row, strava_wrapped_snapshots: [{ ...storedSnapshot, build_id: "build-2" }],
        }));
      }
      for (const [key, filter] of url.searchParams) {
        const [column, field] = key.split("->>");
        if (["select", "order", "limit", "offset"].includes(key) || key.includes(".")) continue;
        const fieldValue = (row: Record<string, unknown>) => field ? (row[column] as Record<string, unknown>)?.[field] : row[column];
        if (filter.startsWith("eq.")) rows = rows.filter((row) => String(fieldValue(row)) === filter.slice(3));
        if (filter.startsWith("in.(")) rows = rows.filter((row) => filter.slice(4, -1).split(",").includes(String(fieldValue(row))));
        if (filter.startsWith("gt.")) rows = rows.filter((row) => String(fieldValue(row)) > filter.slice(3));
      }
      const snapshotVersion = url.searchParams.get("strava_wrapped_snapshots.version");
      if (table === "strava_runner_activities" && snapshotVersion) {
        rows = rows.map((row) => ({
          ...row,
          strava_wrapped_snapshots: (row.strava_wrapped_snapshots as typeof storedSnapshot[])
            .filter((stored) => `eq.${stored.version}` === snapshotVersion),
        }));
      }
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? rows.length);
      if (url.searchParams.get("order") === "status.desc") {
        rows = [...rows].sort((left, right) => String(right.status).localeCompare(String(left.status)));
      }
      rows = rows.slice(offset, offset + limit);
      const accept = new Headers(init?.headers).get("accept");
      return Response.json(accept?.includes("vnd.pgrst.object") ? rows[0] ?? null : rows);
    } },
  });
  return { client, requests };
}
