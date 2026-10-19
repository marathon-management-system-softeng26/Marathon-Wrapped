import { beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

describe.skipIf(process.env.RUN_DATABASE_TESTS !== "1")("dedicated Supabase → authenticated HTTP → computed recap", () => {
  let ids: Record<string, string>;
  let cookies: Record<string, string>;
  const origin = process.env.TEST_APP_URL ?? "http://127.0.0.1:3007";
  beforeAll(async () => {
    const url = process.env.SUPABASE_URL!;
    const ref = process.env.SUPABASE_DEMO_PROJECT_REF;
    if (!ref || new URL(url).hostname !== `${ref}.supabase.co`) throw new Error("Dedicated test project opt-in required.");
    if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname)) throw new Error("HTTP tests require a local app server.");
    const admin = createClient(url, (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)!, { auth: { persistSession: false, autoRefreshToken: false } });
    const runners = await admin.from("runners").select("id,bib_number");
    if (runners.error || !runners.data) throw new Error("Unable to read dedicated fixtures.");
    ids = Object.fromEntries(runners.data.map(r => [r.bib_number, r.id]));
    cookies = {};
    for (const [name, email] of Object.entries({ a: process.env.DEMO_RUNNER_A_EMAIL, b: process.env.DEMO_RUNNER_B_EMAIL, organizer: process.env.DEMO_ORGANIZER_EMAIL })) {
      const jar = new Map<string, string>();
      const auth = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { cookies: {
        getAll: () => [...jar].map(([name, value]) => ({ name, value })),
        setAll: values => { for (const value of values) jar.set(value.name, value.value); },
      } });
      const login = await auth.auth.signInWithPassword({ email: email!, password: process.env.DEMO_PASSWORD! });
      if (login.error) throw new Error(`Dedicated ${name} login failed.`);
      cookies[name] = [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
    }
  }, 60000);

  const get = (bib: string, account?: string) => fetch(`${origin}/api/runners/${ids[bib]}/wrapped`, { headers: account ? { Cookie: cookies[account] } : {} });
  it("blocks anonymous access", async () => expect((await get("HERO-5K-001")).status).toBe(401));
  it("serves Aina's computed result to Aina with private cache headers", async () => {
    const response = await get("HERO-5K-001", "a");
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    const payload = await response.json();
    expect(payload.status).toBe("finisher"); expect(payload.stats.elapsed_seconds).toBe(1523);
    expect(payload.stats.fastest_km).toEqual({ km_marker: 5, split_seconds: 290 });
    expect(payload.stats.first_half_seconds).toBe(617); expect(payload.strava.state).toBe("demo");
    expect(JSON.stringify(payload)).not.toMatch(/access_token|service_role|date_of_birth|id_number|email/);
  });
  it("does not reuse another runner's authorization or response", async () => {
    expect((await get("HERO-10K-001", "a")).status).toBe(404);
    const response = await get("HERO-10K-001", "b"); expect(response.status).toBe(200);
    expect((await response.json()).stats.bib_number).toBe("HERO-10K-001");
  });
  it.each([["EDGE-DNF", "dnf"], ["EDGE-DNS", "dns"], ["EDGE-NO-RESULT", "unavailable"]])("preserves %s lifecycle", async (bib, status) => {
    const response = await get(bib, "organizer"); expect(response.status).toBe(200);
    const payload = await response.json(); expect(payload.status).toBe(status);
    if (status !== "unavailable") { expect(payload.stats.elapsed_seconds).toBeNull(); expect(payload.stats.avg_pace_sec_km).toBeNull(); }
  });
  it.each(["EDGE-NO-STRAVA", "EDGE-NO-PHOTOS"])("keeps %s baseline usable", async bib => {
    const response = await get(bib, "organizer"); expect(response.status).toBe(200);
    const payload = await response.json(); expect(payload.status).toBe("finisher");
    if (bib === "EDGE-NO-STRAVA") expect(payload.strava.metrics).toBeNull();
    if (bib === "EDGE-NO-PHOTOS") expect(payload.photos).toEqual([]);
  });
  it("blocks direct anonymous Data API reads of the view", async () => {
    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/runner_wrapped?select=runner_id`, { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY! } });
    expect([401, 403]).toContain(response.status);
  });
});
