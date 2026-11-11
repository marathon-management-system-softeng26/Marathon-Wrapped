import { test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

// Optional isolated Postgres runtime; install PGlite outside the repo and point this at its entry module.
test(
  "Strava migration and lifecycle interleavings on PostgreSQL",
  { skip: !process.env.STRAVA_PGLITE_MODULE },
  async () => {
    const { PGlite } = await import(
      pathToFileURL(resolve(process.env.STRAVA_PGLITE_MODULE!)).href
    );
    const db = new PGlite();

    try {
      await db.exec(`
        create schema auth;

        create table auth.users (
          id uuid primary key
        );

        create role anon;
        create role authenticated;
        create role service_role bypassrls;
      `);

      const claimMigrations = (await readdir("supabase/migrations"))
        .filter((file) => file.endsWith("_strava_first_runner_claims.sql"))
        .sort().map((file) => `supabase/migrations/${file}`);
      for (const file of [
        "supabase/migrations/20261019155810_initial_schema.sql",
        "supabase/migrations/20261019184443_core_access_and_rank_contract.sql",
        "supabase/migrations/20261019185554_result_lifecycle_guards.sql",
        "supabase/migrations/20261019190232_organizer_management.sql",
        "supabase/migrations/20261020020029_organizer_optional_aggregate.sql",
        "supabase/migrations/20261026175630_strava_integration.sql",
        "supabase/migrations/20261028192351_strava_lifecycle.sql",
        "supabase/migrations/20261101000100_strava_race_matching.sql",
        "supabase/migrations/20261101000200_strava_worker_matching.sql",
        "supabase/migrations/20261102074802_strava_atomic_confirmation.sql",
        "tests/sql/strava-scope-upgrade.sql",
        "supabase/migrations/20261102192931_strava_runner_scope_privacy.sql",
        ...claimMigrations,
        "tests/sql/strava-lifecycle.sql",
        "tests/sql/strava-processing.sql",
        "tests/sql/strava-confirmation.sql",
        "tests/sql/strava-scope.sql",
        "tests/sql/runner-claims.sql",
      ]) {
        await db.exec(await readFile(file, "utf8"));
        if (file.endsWith("strava_runner_scope_privacy.sql")) await db.exec("select pg_temp.verify_strava_scope_upgrade()");
      }

      // PGlite queues these calls on one connection: this tests competing requests
      // and the ownership constraint, not independent PostgreSQL lock scheduling.
      await db.exec(`
        insert into auth.users values ('10000000-0000-0000-0000-000000000001'),
          ('10000000-0000-0000-0000-000000000002');
        insert into public.events(id,name,event_date) overriding system value values (991,'Claim race','2027-08-17');
        insert into public.categories(id,event_id,name,distance_km,min_age) overriding system value values (991,991,'5K',5,17);
        insert into public.runners(id,category_id,name,date_of_birth,gender,email,phone,id_type,id_number,jersey_size)
          values ('20000000-0000-0000-0000-000000000001',991,'Race runner','1990-01-01','M','race@example.invalid','0','Passport','race','M');
        insert into public.organizer_access values ('10000000-0000-0000-0000-000000000001',991);
        set role service_role;
        select public.create_runner_claim('10000000-0000-0000-0000-000000000001',991,
          '20000000-0000-0000-0000-000000000001',repeat('9',64),now()+interval '7 days');
      `);
      const competitors = await Promise.all([
        db.query("select public.consume_runner_claim('10000000-0000-0000-0000-000000000001',repeat('9',64)) as result"),
        db.query("select public.consume_runner_claim('10000000-0000-0000-0000-000000000002',repeat('9',64)) as result"),
      ]);
      assert.deepEqual(competitors.map((result) => result.rows[0].result).sort(), ["claimed", "invalid_claim"]);
      const owners = await db.query("select count(*)::int as count from public.runner_access where runner_id='20000000-0000-0000-0000-000000000001'");
      assert.equal(owners.rows[0].count, 1);
      await db.exec("reset role");

      // Re-run the migration with legacy duplicate owners. It must abort before
      // modifying data and give operators an actionable diagnostic.
      await db.exec(`
        drop index public.runner_access_one_owner;
        insert into public.runner_access values ('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001');
      `);
      await assert.rejects(db.exec(await readFile(claimMigrations[0], "utf8")), /duplicate direct owners/i);
      const preserved = await db.query("select count(*)::int as count from public.runner_access where runner_id='20000000-0000-0000-0000-000000000001'");
      assert.equal(preserved.rows[0].count, 2);
    } finally {
      await db.close();
    }
  },
);
