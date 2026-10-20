import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

describe.skipIf(process.env.RUN_DATABASE_TESTS !== "1")("dedicated Supabase → authenticated HTTP → computed recap", () => {
  let ids: Record<string, string>;
  let cookies: Record<string, string>;
  let admin: SupabaseClient;
  let eventId: number;
  const origin = process.env.TEST_APP_URL ?? "http://127.0.0.1:3007";
  beforeAll(async () => {
    const url = process.env.SUPABASE_URL!;
    const ref = process.env.SUPABASE_DEMO_PROJECT_REF;
    if (!ref || new URL(url).hostname !== `${ref}.supabase.co`) throw new Error("Dedicated test project opt-in required.");
    if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname)) throw new Error("HTTP tests require a local app server.");
    admin = createClient(url, (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)!, { auth: { persistSession: false, autoRefreshToken: false } });
    const event = await admin.from("events").select("id").eq("name", "Soekarno Run 2027").single();
    if (event.error || !event.data) throw new Error("Dedicated event fixture missing.");
    eventId = event.data.id;
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
  it("persists login route cookies across catalog and nested recap requests",async()=>{
    const response=await fetch(`${origin}/api/auth/login`,{method:"POST",headers:{Origin:origin,"Content-Type":"application/json"},body:JSON.stringify({email:process.env.DEMO_RUNNER_A_EMAIL,password:process.env.DEMO_PASSWORD})});
    expect(response.status).toBe(200);const values=response.headers.getSetCookie();expect(values.length).toBeGreaterThan(0);expect(values.every(value=>/path=\//i.test(value))).toBe(true);
    const cookie=values.map(value=>value.split(";")[0]).join("; ");
    expect((await fetch(`${origin}/api/session`,{headers:{Cookie:cookie}})).status).toBe(200);
    expect((await fetch(`${origin}/api/runners/${ids["HERO-5K-001"]}/wrapped`,{headers:{Cookie:cookie}})).status).toBe(200);
  });
  it("limits the catalog to verified mappings and organizer scope", async () => {
    expect((await fetch(`${origin}/api/session`)).status).toBe(401);
    const runner=await fetch(`${origin}/api/session`,{headers:{Cookie:cookies.a}});
    expect(runner.status).toBe(200);
    const own=await runner.json();expect(own.runners.map((r:{id:string})=>r.id)).toEqual([ids["HERO-5K-001"]]);expect(own.events).toEqual([]);
    const organizer=await fetch(`${origin}/api/session`,{headers:{Cookie:cookies.organizer}});
    const scope=await organizer.json();expect(scope.runners).toHaveLength(8);expect(scope.events.map((e:{id:number})=>e.id)).toContain(eventId);
  });
  it("restricts private organizer drafts to organizers",async()=>{
    const path=`${origin}/api/organizer/events/${eventId}/runners/${ids["HERO-5K-001"]}`;
    expect((await fetch(path,{headers:{Cookie:cookies.a}})).status).toBe(403);
    const response=await fetch(path,{headers:{Cookie:cookies.organizer}});expect(response.status).toBe(200);const draft=await response.json();
    expect(draft.splits).toHaveLength(5);expect(draft.date_of_birth).toMatch(/^\d{4}-\d{2}-\d{2}$/);expect(draft).not.toHaveProperty("id_number");expect(draft).not.toHaveProperty("email");
  });
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
  it("separates runner and organizer event results", async () => {
    const path = `${origin}/api/organizer/events/${eventId}/results`;
    expect((await fetch(path, { headers: { Cookie: cookies.a } })).status).toBe(403);
    const response = await fetch(path, { headers: { Cookie: cookies.organizer } });
    expect(response.status).toBe(200);
    const { results } = await response.json();
    expect(results).toHaveLength(8);
    expect(results.find((r: { bib_number: string }) => r.bib_number === "EDGE-NO-RESULT").status).toBe("unavailable");
  });
  it("creates and clears optional demo data in the same organizer aggregate",async()=>{
    const bib="QA-FULL-"+crypto.randomUUID().slice(0,8);
    const body={name:"Full aggregate assertion",bib_number:bib,date_of_birth:"1995-04-12",gender:"F",parental_consent:false,category:"5K",result:null,splits:[],enrichment:{metrics:{avg_heartrate:150,max_heartrate:180,elevation_gain_m:25,calories:400,avg_cadence:82},photos:[{photo_url:process.env.SUPABASE_URL+"/storage/v1/object/public/race-photos/demo-race.jpg",photographer:"Martin Vorel (CC0; QA stock)",captured_km:null,captured_at:null}]}};
    const headers={Cookie:cookies.organizer,Origin:origin,"Content-Type":"application/json"};let createdId:string|null=null;
    try{
      const response=await fetch(`${origin}/api/organizer/events/${eventId}/runners`,{method:"POST",headers,body:JSON.stringify(body)});expect(response.status).toBe(201);createdId=(await response.json()).runner_id;
      const path=`${origin}/api/organizer/events/${eventId}/runners/${createdId}`;
      const draft=await (await fetch(path,{headers})).json();expect(draft.enrichment.metrics.avg_heartrate).toBe(150);expect(draft.enrichment.photos).toHaveLength(1);expect(draft.enrichment.metrics).not.toHaveProperty("data_source");
      const invalid=await fetch(path,{method:"PATCH",headers,body:JSON.stringify({...body,name:"Should not persist",enrichment:{...body.enrichment,photos:[{...body.enrichment.photos[0],captured_km:6}]}})});expect(invalid.status).toBe(422);
      const preserved=await (await fetch(path,{headers})).json();expect(preserved.name).toBe(body.name);expect(preserved.enrichment.photos).toHaveLength(1);
      const cleared=await fetch(path,{method:"PATCH",headers,body:JSON.stringify({...body,enrichment:{metrics:null,photos:[]}})});expect(cleared.status).toBe(200);
      const empty=await (await fetch(path,{headers})).json();expect(empty.enrichment).toEqual({metrics:null,photos:[]});
    }finally{if(createdId){const cleanup=await admin.from("runners").delete().eq("id",createdId).eq("bib_number",bib);if(cleanup.error)throw new Error("Full aggregate fixture cleanup failed.");}}
  },20000);
  it("atomically creates and updates a disposable organizer demo runner", async () => {
    const bib = "QA-HTTP-" + crypto.randomUUID().slice(0,8);
    const body = { name: "HTTP management assertion", bib_number: bib, date_of_birth: "1995-04-12", gender: "F", parental_consent: false,
      category: "5K", result: { finisher: true, start_status: "on-time", start_time: "2027-08-17T06:00:00+07:00", finish_time: "2027-08-17T06:25:00+07:00" },
      splits: Array.from({ length: 5 }, (_, i) => ({ km_marker: i+1, split_seconds: 300 })) };
    const headers = { Cookie: cookies.organizer, Origin: origin, "Content-Type": "application/json" };
    let createdId: string | null = null;
    try {
      const created = await fetch(`${origin}/api/organizer/events/${eventId}/runners`, { method: "POST", headers, body: JSON.stringify(body) });
      expect(created.status).toBe(201); createdId = (await created.json()).runner_id;
      const changed = await fetch(`${origin}/api/organizer/events/${eventId}/runners/${createdId}`, { method: "PATCH", headers, body: JSON.stringify({ ...body, name: "Updated HTTP assertion" }) });
      expect(changed.status).toBe(200);
      const duplicate = await fetch(`${origin}/api/organizer/events/${eventId}/runners`, { method: "POST", headers, body: JSON.stringify(body) });
      expect(duplicate.status).toBe(409);
    } finally {
      if (createdId) {
        const removed = await admin.from("runners").delete().eq("id", createdId).eq("bib_number", bib);
        if (removed.error) throw new Error("Disposable HTTP fixture cleanup failed.");
      }
    }
  }, 20000);
});
