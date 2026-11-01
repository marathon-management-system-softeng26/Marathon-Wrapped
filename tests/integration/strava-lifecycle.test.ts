import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

describe.skipIf(process.env.RUN_STRAVA_DATABASE_TESTS !== "1")(
  "Strava concurrent database transitions (dedicated project only)",
  () => {
    let admin: SupabaseClient;
    const users: string[] = [];
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
      for (const id of users) {
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
  },
);
