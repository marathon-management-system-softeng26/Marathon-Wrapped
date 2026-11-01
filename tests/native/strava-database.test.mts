import { test } from "node:test";
import { readFile } from "node:fs/promises";
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
        "tests/sql/strava-lifecycle.sql",
        "tests/sql/strava-processing.sql",
      ]) {
        await db.exec(await readFile(file, "utf8"));
      }
    } finally {
      await db.close();
    }
  },
);
