import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

describe.skipIf(process.env.RUN_STRAVA_DATABASE_TESTS !== "1")(
  "Strava concurrent database transitions (dedicated project only)",
  () => {
    let admin: SupabaseClient;
    const users: string[] = [];
    const matchingUsers: string[] = [];
    const events: number[] = [];
    const prefix = crypto.randomUUID();

    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const { data, error } = await admin.rpc(name, args);

      if (error) {
        throw error;
      }

      return data;
    };

    beforeAll(async () => {
      const url = process.env.SUPABASE_URL!;
      const ref = process.env.SUPABASE_DEMO_PROJECT_REF;

      if (!ref || new URL(url).hostname !== `${ref}.supabase.co`) {
        throw new Error("Dedicated test project opt-in required.");
      }

      admin = createClient(
        url,
        (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );

      for (let i = 0; i < 2; i++) {
        const { data, error } = await admin.auth.admin.createUser({
          email: `strava-${prefix}-${i}@example.invalid`,
        });

        if (error || !data.user) {
          throw new Error("Could not create disposable Strava test user.");
        }

        users.push(data.user.id);
      }
    });

    afterAll(async () => {
      for (const id of events) {
        const { error } = await admin.from("events").delete().eq("id", id);
        if (error) throw new Error("Disposable Strava event cleanup failed.");
      }
      for (const id of [...users, ...matchingUsers]) {
        const { error } = await admin.auth.admin.deleteUser(id);

        if (error) {
          throw new Error("Disposable Strava test user cleanup failed.");
        }
      }
    });

    it("isolates users, claims callbacks once, and arbitrates a shared athlete", async () => {
      const hashes = users.map((_, i) => `${prefix}-${i}`);

      expect(
        await Promise.all(
          users.map((p_user, i) =>
            call("strava_begin_oauth", { p_user, p_hash: hashes[i] }),
          ),
        ),
      ).toEqual(["ready", "ready"]);
      expect(
        await call("strava_claim_oauth", { p_user: users[1], p_hash: hashes[0] }),
      ).toBe("invalid_state");

      const claims = await Promise.all(
        [0, 0, 1].map((i) =>
          call("strava_claim_oauth", { p_user: users[i], p_hash: hashes[i] }),
        ),
      );

      expect(claims.slice(0, 2).sort()).toEqual(["claimed", "processing"]);
      expect(claims[2]).toBe("claimed");

      const p_tokens = {
        athlete_id: String(Date.now()),
        access_token: "synthetic-encrypted-access",
        refresh_token: "synthetic-encrypted-refresh",
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        scopes: ["activity:read_all"],
      };
      const results = await Promise.all(
        users.map((p_user, i) =>
          call("strava_finish_oauth", { p_user, p_hash: hashes[i], p_tokens }),
        ),
      );

      expect(results.sort()).toEqual(["athlete_conflict", "connected"]);

      const winner = await admin
        .from("strava_connections")
        .select("user_id,generation")
        .eq("athlete_id", p_tokens.athlete_id)
        .single();

      expect(winner.error).toBeNull();

      const p_user = winner.data!.user_id;
      const p_generation = winner.data!.generation;
      const credentials = await Promise.all(
        [1, 2].map(() =>
          call("strava_claim_credentials", { p_user, p_kind: "refresh" }),
        ),
      );

      expect(credentials.filter((c) => c.busy).length).toBe(1);

      const operation = credentials.find((c) => c.operation_id);

      await call("strava_finish_refresh", {
        p_user,
        p_generation,
        p_operation: operation.operation_id,
      });
      await Promise.all(
        [1, 2].map(() =>
          call("strava_enqueue", {
            p_user,
            p_generation,
            p_kind: "webhook",
            p_key: "duplicate",
            p_payload: {},
          }),
        ),
      );

      const jobs = await admin.from("strava_jobs").select("id").eq("user_id", p_user);

      expect(jobs.error).toBeNull();
      expect(jobs.data).toHaveLength(1);

      await call("strava_disconnect", { p_user });

      expect(
        await call("strava_enqueue", {
          p_user,
          p_generation,
          p_kind: "webhook",
          p_key: "stale",
          p_payload: {},
        }),
      ).toBe(false);
    });

    it("serializes runner selection and disconnect without replacing demo metrics", async () => {
      const created = await admin.auth.admin.createUser({
        email: `strava-${prefix}-matching@example.invalid`,
      });
      expect(created.error).toBeNull();
      const p_user = created.data.user!.id;
      matchingUsers.push(p_user);

      const event = await admin.from("events").insert({
        name: `Strava matching test ${prefix}`, event_date: "2027-08-17",
      }).select("id").single();
      expect(event.error).toBeNull();
      events.push(event.data!.id);
      const category = await admin.from("categories").insert({
        event_id: event.data!.id, name: "5K", distance_km: 5, min_age: 17,
      }).select("id").single();
      expect(category.error).toBeNull();
      const runner = await admin.from("runners").insert({
        category_id: category.data!.id, name: "Disposable matching runner", date_of_birth: "1990-01-01",
        gender: "M", email: "matching@example.invalid", phone: "0", id_type: "Passport",
        id_number: prefix, jersey_size: "M",
      }).select("id").single();
      expect(runner.error).toBeNull();
      const p_runner = runner.data!.id;
      expect((await admin.from("runner_access").insert({ user_id: p_user, runner_id: p_runner })).error).toBeNull();
      expect((await admin.from("strava_race_configs").insert({
        category_id: category.data!.id, start_time_from: "2027-08-17T00:00:00Z", start_time_to: "2027-08-17T02:00:00Z",
      })).error).toBeNull();

      const p_hash = `${prefix}-runner`;
      expect(await call("strava_begin_runner_oauth", { p_user, p_runner, p_hash, p_return_path: `/wrapped/${p_runner}` })).toBe("ready");
      const claims = await Promise.all([1, 2].map(() => call("strava_claim_runner_oauth", { p_user, p_hash })));
      expect(claims.map((claim) => claim.status).sort()).toEqual(["claimed", "processing"]);
      expect(Object.keys(claims[0]).sort()).toEqual(["generation", "return_path", "runner_id", "status"]);
      expect(await call("strava_finish_oauth", { p_user, p_hash, p_tokens: {
        athlete_id: p_user, access_token: "synthetic-encrypted-access", refresh_token: "synthetic-encrypted-refresh",
        expires_at: new Date(Date.now() + 3600000).toISOString(), scopes: ["activity:read_all"],
      } })).toBe("connected");
      const connection = await admin.from("strava_connections").select("generation").eq("user_id", p_user).single();
      expect(connection.error).toBeNull();
      const p_generation = connection.data!.generation;
      expect((await admin.from("strava_activities").insert(["one", "two"].map((activity_id) => ({
        user_id: p_user, generation: p_generation, activity_id, activity: {},
      })))).error).toBeNull();
      await call("strava_store_runner_candidates", { p_user, p_generation, p_runner,
        p_candidates: ["one", "two"].map((activity_id) => ({ activity_id, match_status: "needs_confirmation", reason: "missing_start_location", summary: {} })),
      });
      expect(await Promise.all(["one", "two"].map((p_activity, index) => call("strava_select_runner_activity", {
        p_user, p_generation, p_runner, p_activity, p_metrics: { calories: 100 + index },
      })))).toEqual(["selected", "selected"]);
      const selected = await admin.from("strava_runner_activities").select("activity_id").eq("runner_id", p_runner).single();
      const metrics = await admin.from("strava_live_metrics").select("activity_id,calories").eq("runner_id", p_runner).single();
      expect(selected.error).toBeNull();
      expect(metrics.error).toBeNull();
      expect(metrics.data!.activity_id).toBe(selected.data!.activity_id);
      expect(metrics.data!.calories).toBe(selected.data!.activity_id === "one" ? 100 : 101);
      expect((await admin.from("strava_metrics").insert({ runner_id: p_runner, avg_heartrate: 123, data_source: "demo" })).error).toBeNull();
      const workerId = crypto.randomUUID();
      const workerLease = crypto.randomUUID();
      expect((await admin.from("strava_jobs").insert({
        id: workerId, user_id: p_user, generation: p_generation, kind: "activity",
        dedupe_key: "worker-disconnect-race", status: "processing", lease_id: workerLease,
        lease_until: new Date(Date.now() + 120000).toISOString(), attempts: 1,
      })).error).toBeNull();
      await Promise.all([
        call("strava_disconnect", { p_user }),
        call("strava_select_runner_activity", { p_user, p_generation, p_runner, p_activity: "one", p_metrics: {} }),
        call("strava_commit_runner_job", {
          p_job: workerId, p_lease: workerLease,
          p_activities: [{ id: "one", activity: { id: "one", calories: 200 } }],
          p_runner_candidates: [{ runner_id: p_runner, candidates: [{
            activity_id: "one", match_status: "auto_match", reason: "race_checks_passed", summary: {},
          }] }],
        }),
      ]);
      for (const table of ["strava_runner_activities", "strava_live_metrics", "strava_activity_candidates"]) {
        const remaining = await admin.from(table).select("runner_id").eq("runner_id", p_runner);
        expect(remaining.error).toBeNull();
        expect(remaining.data).toEqual([]);
      }
      const demo = await admin.from("strava_metrics").select("avg_heartrate,data_source").eq("runner_id", p_runner).single();
      expect(demo.error).toBeNull();
      expect(demo.data).toEqual({ avg_heartrate: 123, data_source: "demo" });
      expect(await call("strava_select_runner_activity", { p_user, p_generation, p_runner, p_activity: "one", p_metrics: {} })).toBe("obsolete");
    });
  },
);
