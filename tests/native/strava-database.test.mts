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
        "supabase/migrations/20261026175630_strava_integration.sql",
        "supabase/migrations/20261028192351_strava_lifecycle.sql",
        "tests/sql/strava-lifecycle.sql",
      ]) {
        await db.exec(await readFile(file, "utf8"));
      }
    } finally {
      await db.close();
    }
  },
);
