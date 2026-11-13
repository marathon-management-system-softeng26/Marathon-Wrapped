import { beforeEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  database: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
}));
vi.mock("@/lib/auth/session", async (original) => ({
  ...(await original<object>()),
  requireUser: mocks.user,
}));
vi.mock("@/lib/supabaseServer", () => ({ getSupabaseAdmin: mocks.database }));
vi.mock("@/lib/supabaseSession", () => ({
  createSupabaseSession: async () => ({
    auth: { signInWithPassword: mocks.login, signOut: mocks.logout },
  }),
}));
import { GET } from "@/app/api/session/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { AuthenticationError } from "@/lib/auth/session";
import { AuthRetryableFetchError, createClient } from "@supabase/supabase-js";
import { snapshot } from "../fixtures/stravaWrapped";

function catalogDatabase() {
  const userId = "verified";
  const generation = "generation-current";
  const ownedIds = ["attach", "import", "confirm", "no-match", "build", "ready", "failed", "invalid"];
  const event = { id: 1, name: "Soekarno Run" };
  const runners = [...ownedIds, "event-only"].map((id) => ({
    id, category_id: 1, name: `Runner ${id}`, bib_number: `BIB-${id}`,
    categories: { name: "5K", events: event },
  }));
  const scope = { user_id: userId, generation };
  const attach = (runner_id: string) => ({ ...scope, runner_id, attachment_id: `fence-${runner_id}`, status: "active" });
  const ready = { ...snapshot, runner: { ...snapshot.runner, id: "ready" } };
  const candidate = {
    activity_id: "123456789", match_status: "needs_confirmation", reason: "missing_start_location",
    summary: { startDate: "2027-08-16T23:00:00Z", distanceMeters: 5100, gpsAvailable: true },
    strava_activities: { id: "123456789", athleteId: "987654321", sportType: "Run" },
  };
  const tables: Record<string, Record<string, unknown>[]> = {
    runner_access: ownedIds.map((runner_id, index) => ({ user_id: userId, runner_id, runners: runners[index] })),
    organizer_access: [{ user_id: userId, event_id: 1, events: event }, { user_id: "organizer", event_id: 1, events: event }],
    events: [event],
    categories: [{ id: 1, event_id: 1 }],
    runners,
    strava_connections: [{ ...scope, status: "active", athlete_id: "987654321", credentials_uncertain: false,
      granted_scopes: ["activity:read_all"], access_token: "private-token" }],
    strava_oauth_attempts: [],
    strava_runner_attachments: [...ownedIds.slice(1).map(attach), { ...attach("attach"), generation: "old" }],
    strava_runner_activities: ["build", "ready", "failed", "invalid"].map((runner_id) => ({
      ...scope, runner_id, activity_id: "123456789", strava_wrapped_snapshots: {
        build: [], ready: [{ status: "ready", payload: ready }], failed: [{ status: "failed", payload: null }],
        invalid: [{ status: "ready", payload: { ...ready, activityId: "123456789" } }],
      }[runner_id],
    })),
    strava_jobs: [
      { ...scope, kind: "backfill", status: "failed", attachment_fences: { import: "fence-import", failed: "fence-failed" } },
      { ...scope, kind: "webhook", status: "pending", attachment_fences: { import: "fence-import", "no-match": "stale", "event-only": "organizer" } },
    ],
    strava_activity_candidates: [
      { ...scope, runner_id: "confirm", ...candidate },
      { ...scope, runner_id: "no-match", ...candidate, strava_activities: { ...candidate.strava_activities, athleteId: "1" } },
    ],
  };
  const requests: URL[] = [];
  const client = createClient("https://catalog.invalid", "test-server-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input) => {
      const url = new URL(input instanceof Request ? input.url : input);
      requests.push(url);
      const table = url.pathname.split("/").at(-1)!;
      if (!(table in tables)) return Response.json({ message: `Unexpected table ${table}` }, { status: 400 });
      let rows = tables[table];
      for (const [field, filter] of url.searchParams) {
        if (filter.startsWith("eq.") && !field.includes(".")) rows = rows.filter((row) => String(row[field]) === filter.slice(3));
        if (filter.startsWith("in.(")) rows = rows.filter((row) => filter.slice(4, -1).split(",").includes(String(row[field])));
        if (filter.startsWith("gt.")) rows = rows.filter((row) => String(row[field]) > filter.slice(3));
      }
      return Response.json(rows);
    } },
  });
  mocks.database.mockReturnValue(client);
  return { tables, requests };
}
const request = (body: unknown, origin = "http://localhost") =>
  new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
describe("session HTTP boundaries", () => {
  it("reports temporary login network failures as retryable service errors", async () => {
    mocks.login.mockResolvedValue({
      error: new AuthRetryableFetchError("private network detail", 0),
    });
    const response = await login(
      request({ email: "a@example.test", password: "test" }),
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private network detail");
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ id: "verified" });
    mocks.login.mockResolvedValue({ error: null });
    mocks.logout.mockResolvedValue({ error: null });
  });
  it("blocks login CSRF before touching authentication", async () => {
    expect(
      (
        await login(
          request({ email: "x", password: "x" }, "https://other.example"),
        )
      ).status,
    ).toBe(403);
    expect(mocks.login).not.toHaveBeenCalled();
  });
  it("blocks logout CSRF", async () => {
    expect((await logout(request({}, "https://other.example"))).status).toBe(
      403,
    );
    expect(mocks.logout).not.toHaveBeenCalled();
  });
  it("validates login input and redacts provider errors", async () => {
    expect((await login(request({ email: 17, password: "x" }))).status).toBe(
      400,
    );
    mocks.login.mockResolvedValue({
      error: { message: "private internal detail" },
    });
    const response = await login(
      request({ email: "a@example.test", password: "test" }),
    );
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("internal");
  });
  it("tells a valid-password user when email confirmation is required", async () => {
    mocks.login.mockResolvedValue({
      error: { code: "email_not_confirmed", message: "Email not confirmed" },
    });
    const response = await login(
      request({ email: "a@example.test", password: "test" }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Confirm your email before signing in.",
    });
  });
  it("signs in through the cookie-aware client", async () => {
    const response = await login(
      request({ email: " a@example.test ", password: "test" }),
    );
    expect(response.status).toBe(200);
    expect(mocks.login).toHaveBeenCalledWith({
      email: "a@example.test",
      password: "test",
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("uses verified user identity for the catalog", async () => {
    const { requests } = catalogDatabase();
    expect((await GET()).status).toBe(200);
    expect(requests.find((url) => url.pathname.endsWith("/runner_access"))?.searchParams.get("user_id")).toBe("eq.verified");
  });
  it("requires authentication before any catalog read", async () => {
    mocks.user.mockRejectedValue(new AuthenticationError());
    expect((await GET()).status).toBe(401);
    expect(mocks.database).not.toHaveBeenCalled();
  });
  it("derives private runner actions using batched, owner-scoped storage reads", async () => {
    const { requests } = catalogDatabase();
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.text();
    const { runners, events } = JSON.parse(body);
    expect(events).toEqual([{ id: 1, name: "Soekarno Run" }]);
    expect(runners).toContainEqual({ id: "attach", name: "Runner attach", bib_number: "BIB-attach", event: "Soekarno Run",
      category: "5K", workflowState: "setup_required", primaryAction: "attach" });
    expect(Object.fromEntries(runners.map((row: Record<string, string>) => [row.id, [row.workflowState, row.primaryAction]]))).toEqual({
      attach: ["setup_required", "attach"], import: ["importing", "importing"], confirm: ["needs_confirmation", "confirm"],
      "no-match": ["no_match", "review_import"], build: ["building", "building"], ready: ["ready", "view"],
      failed: ["failed", "failed"], invalid: ["failed", "failed"],
    });
    expect(body).not.toMatch(/987654321|123456789|private-token|activity_id|athlete_id|payload|candidate|fence/);
    const tables = requests.map((url) => url.pathname.split("/").at(-1));
    expect(new Set(tables).size).toBe(tables.length);
    for (const url of requests.filter((url) => url.pathname.includes("/strava_"))) {
      expect(url.searchParams.get("user_id")).toBe("eq.verified");
      expect(url.searchParams.get("select")).not.toMatch(/access_token|refresh_token|\*/);
      expect(url.href).not.toContain("event-only");
    }
  });

  it("returns organizer events without reading organizer-only runners or Strava state", async () => {
    const { requests } = catalogDatabase();
    mocks.user.mockResolvedValue({ id: "organizer" });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ runners: [], events: [{ id: 1, name: "Soekarno Run" }] });
    expect(requests.map((url) => url.pathname.split("/").at(-1)).sort()).toEqual(["organizer_access", "runner_access"]);
  });

  it("distinguishes unconnected, authorizing, and expired or insufficient permission", async () => {
    const { tables } = catalogDatabase();
    const connection = tables.strava_connections[0];
    tables.strava_connections = [];
    const status = async () => {
      const response = await GET();
      expect(response.status).toBe(200);
      const { runners } = await response.json();
      return runners.find((row: { id: string }) => row.id === "attach");
    };
    expect(await status()).toMatchObject({ workflowState: "setup_required", primaryAction: "connect" });
    tables.strava_connections = [{ ...connection, granted_scopes: ["read"] }];
    tables.strava_oauth_attempts = [
      { user_id: "verified", generation: "generation-current", runner_id: "attach", status: "pending", expires_at: "2999-01-01T00:00:00Z" },
    ];
    expect(await status()).toMatchObject({ workflowState: "authorizing", primaryAction: "check_authorization" });
    tables.strava_oauth_attempts[0].expires_at = "2000-01-01T00:00:00Z";
    expect(await status()).toMatchObject({ workflowState: "reauth_required", primaryAction: "reauthorize" });
  });
});
