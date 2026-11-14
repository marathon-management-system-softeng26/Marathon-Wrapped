import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), save: vi.fn(), results: vi.fn(), access: vi.fn(), database: vi.fn() }));
vi.mock("@/lib/auth/session", async original => ({ ...await original<object>(), requireUser: mocks.user }));
vi.mock("@/lib/auth/access", async original => ({ ...await original<object>(), requireOrganizerAccess: mocks.access }));
vi.mock("@/lib/supabaseServer", () => ({ getSupabaseAdmin: mocks.database }));
vi.mock("@/controllers/organizerController", async original => ({ ...await original<object>(), saveHeroRunner: mocks.save, getEventResults: mocks.results }));
import { POST } from "@/app/api/organizer/events/[eventId]/runners/route";
import { GET } from "@/app/api/organizer/events/[eventId]/results/route";
import { GET as readConfig, PUT as writeConfig } from "@/app/api/organizer/events/[eventId]/strava-config/route";
import { AccessDeniedError } from "@/lib/auth/access";
const params = { params: Promise.resolve({ eventId: "1" }) };
const request = (origin = "http://localhost") => new Request("http://localhost/api/organizer/events/1/runners", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ name: "Demo" }) });
describe("organizer HTTP boundaries", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ id: "organizer" }); mocks.save.mockResolvedValue({ runner_id: "saved" }); mocks.results.mockResolvedValue([{ status: "unavailable" }]); mocks.access.mockResolvedValue(undefined); });
  it("rejects cross-origin cookie-authenticated writes before queries", async () => {
    expect((await POST(request("https://attacker.example"), params)).status).toBe(403);
    expect(mocks.user).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("validates the event identifier before queries", async () => {
    expect((await GET(new Request("http://localhost"), { params: Promise.resolve({ eventId: "invalid" }) })).status).toBe(400);
    expect(mocks.results).not.toHaveBeenCalled();
  });
  it("uses verified identity and the URL event for a create", async () => {
    const response = await POST(request(), params); expect(response.status).toBe(201);
    expect(mocks.save).toHaveBeenCalledWith("organizer", 1, null, { name: "Demo" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("compares the browser origin with the actual Host, not Next's internal hostname", async () => {
    const incoming = new Request("http://localhost:3007/api/organizer/events/1/runners", {
      method: "POST", headers: { Host: "127.0.0.1:3007", Origin: "http://127.0.0.1:3007", "Content-Type": "application/json" }, body: "{}",
    });
    expect((await POST(incoming, params)).status).toBe(201);
  });
  it("reports event access denial without returning event rows", async () => {
    mocks.results.mockRejectedValue(new AccessDeniedError());
    const response = await GET(new Request("http://localhost"), params);
    expect(response.status).toBe(403); expect(await response.json()).not.toHaveProperty("results");
  });
  it("preserves the unavailable lifecycle in organizer results", async () => {
    const response = await GET(new Request("http://localhost"), params);
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ results: [{ status: "unavailable" }] });
  });
});

describe("organizer Strava race configuration", () => {
  type Row = Record<string, unknown>;
  let categories: Row[];
  let configs: Row[];
  let writes: Row[];

  const configRequest = (body: unknown, origin = "http://localhost") =>
    new Request("http://localhost/api/organizer/events/1/strava-config", {
      method: "PUT", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
  const valid = {
    categoryId: 7, startTimeFrom: "2027-08-16T23:00:00+07:00", startTimeTo: "2027-08-17T05:00:00+07:00",
    distanceToleranceM: 400,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ id: "organizer" });
    mocks.access.mockResolvedValue(undefined);
    categories = [{ id: 7, event_id: 1, name: "5K" }, { id: 9, event_id: 2, name: "10K" }];
    configs = [{ category_id: 7, start_time_from: "2027-08-16T16:00:00+00:00", start_time_to: "2027-08-16T22:00:00+00:00",
      allowed_sport_types: ["Run"], distance_tolerance_m: 500, start_latitude: -6.175392, start_longitude: 106.827153, start_radius_m: 250 }];
    writes = [];
    const tables = () => ({ categories, strava_race_configs: configs });
    mocks.database.mockReturnValue({
      from: (table: string) => {
        const filters: ((row: Row) => boolean)[] = [];
        const query: Record<string, unknown> = {
          select: () => query,
          eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return query; },
          in: (key: string, values: unknown[]) => { filters.push((row) => values.includes(row[key])); return query; },
          order: () => query,
          upsert: (row: Row) => { writes.push({ table, ...row }); return Promise.resolve({ error: null }); },
          maybeSingle: async () => {
            const rows = (tables()[table as keyof ReturnType<typeof tables>] ?? []).filter((row) => filters.every((f) => f(row)));
            return { data: rows[0] ?? null, error: null };
          },
          then: (resolve: (value: unknown) => void) => Promise.resolve({
            data: (tables()[table as keyof ReturnType<typeof tables>] ?? []).filter((row) => filters.every((f) => f(row))),
            error: null,
          }).then(resolve),
        };
        return query;
      },
    });
  });

  it("returns only the configured categories of the requested event", async () => {
    const response = await readConfig(new Request("http://localhost"), params);
    expect(response.status).toBe(200);
    expect(mocks.access).toHaveBeenCalledWith("organizer", 1);
    const body = await response.json();
    expect(body.categories).toEqual([{ id: 7, name: "5K", config: expect.objectContaining({ distanceToleranceM: 500 }) }]);
    // The other event's category must not appear at all.
    expect(body.categories.map((category: { id: number }) => category.id)).toEqual([7]);
    expect(JSON.stringify(body)).not.toContain("10K");
  });

  it("stores a complete configuration as a timezone-normalized inclusive window", async () => {
    const response = await writeConfig(configRequest(valid), params);
    expect(response.status).toBe(200);
    expect(writes).toEqual([expect.objectContaining({
      table: "strava_race_configs", category_id: 7,
      start_time_from: "2027-08-16T16:00:00.000Z", start_time_to: "2027-08-16T22:00:00.000Z",
      allowed_sport_types: ["Run"], distance_tolerance_m: 400,
      start_latitude: null, start_longitude: null, start_radius_m: null,
    })]);
  });

  it("denies a category that belongs to another organizer's event without writing", async () => {
    const response = await writeConfig(configRequest({ ...valid, categoryId: 9 }), params);
    expect(response.status).toBe(404);
    expect(writes).toEqual([]);
  });

  it("denies an organizer without access to the requested event", async () => {
    mocks.access.mockRejectedValue(new AccessDeniedError());
    expect((await readConfig(new Request("http://localhost"), params)).status).toBe(403);
    expect((await writeConfig(configRequest(valid), params)).status).toBe(403);
    expect(writes).toEqual([]);
  });

  it("rejects a cross-origin write before any query", async () => {
    expect((await writeConfig(configRequest(valid, "https://attacker.example"), params)).status).toBe(403);
    expect(mocks.user).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it.each([
    ["a window without a time zone", { startTimeFrom: "2027-08-16T23:00:00" }],
    ["an inverted window", { startTimeFrom: "2027-08-17T06:00:00+07:00", startTimeTo: "2027-08-17T05:00:00+07:00" }],
    ["an empty window", { startTimeTo: valid.startTimeFrom }],
    ["a zero tolerance", { distanceToleranceM: 0 }],
    ["a negative tolerance", { distanceToleranceM: -100 }],
    ["a fractional tolerance", { distanceToleranceM: 12.5 }],
    ["an unbounded tolerance", { distanceToleranceM: 500000 }],
    ["a partial start location", { startLatitude: -6.175392 }],
    ["an out-of-range latitude", { startLatitude: 91, startLongitude: 0, startRadiusM: 10 }],
    ["a negative radius", { startLatitude: 0, startLongitude: 0, startRadiusM: -1 }],
    ["a non-Run sport type", { allowedSportTypes: ["Ride"] }],
  ])("refuses %s without writing", async (_label, override) => {
    const response = await writeConfig(configRequest({ ...valid, ...override }), params);
    expect(response.status).toBe(422);
    expect(await response.json()).toHaveProperty("error");
    expect(writes).toEqual([]);
  });

  it("accepts a complete optional start location but never echoes it to runners", async () => {
    const response = await writeConfig(configRequest({ ...valid, startLatitude: -6.175392, startLongitude: 106.827153, startRadiusM: 250 }), params);
    expect(response.status).toBe(200);
    expect(writes[0]).toMatchObject({ start_latitude: -6.175392, start_longitude: 106.827153, start_radius_m: 250 });
  });
});
