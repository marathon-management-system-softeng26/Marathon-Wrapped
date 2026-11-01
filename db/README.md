# /db — Database

Owner: **Rakha** (data) · Postgres on Supabase

The schema lives in `supabase/migrations/20261019155810_initial_schema.sql`.

## Link and apply

Link this checkout to the Supabase project once:

```sh
supabase login
supabase link --project-ref <project-ref>
```

Review pending changes, then apply them to the linked remote database:

```sh
supabase db push --dry-run
supabase db push
```

For each later schema change, create a new migration, put the SQL in the generated file under `supabase/migrations/`, and run the same dry-run and push commands. Don’t edit a migration that has already been applied.

If the schema was already created manually in the remote database, don’t push the initial migration blindly; reconcile the migration history first to avoid duplicate-object errors.

## Reset and seed

The dedicated cloud development project is `anbnuegocddoowagqmxw` (`marathon-wrapped`, organization `buns project`, Singapore). Its initial and follow-up migrations are applied. Use the existing token helper/CLI authentication; never commit tokens or project secret keys.

`db/seed.sql` is transactional and repeatable for eight synthetic BIB fixtures in the Soekarno Run 2027 demo. It uses August 17, 2027 as a fixture date, not a confirmed real event schedule. Three hero runners have chip results, clearly marked demo Strava metrics and manual mappings to an actual CC0 stock photo. These are sample mappings, not real runner/photo identification; see [photo provenance](../public/photos/PROVENANCE.md).

After seeding, `npm run seed:photos` uploads the local sample to the dedicated project's public `race-photos` bucket and updates exactly the three hero mappings. It refuses to change an existing private bucket's access. Reseeding retains the Storage URLs without adding duplicate sample records. The no-photo edge fixture stays empty.

For Auth bootstrap, configure the documented variables in ignored `.env.local`, including an explicit matching `SUPABASE_DEMO_PROJECT_REF`, then run `npm run seed:users`. It creates two synthetic runner accounts and an event-scoped organizer, saving generated credentials to ignored `.env.demo.local`. Do not use this workflow on a production or unrelated project.

Run `npm run build`, then `npm run start -- --port 3007` in one terminal and `npm run test:db` in another for real-session HTTP acceptance. `npm test` deliberately skips the database suite unless opted in; skipped tests are not evidence of database success. `db/tests/core.sql`, `integrity.sql` and `lifecycle.sql` contain additional SQL assertions; mutation checks roll back their changes. Run `npm run test:native` on Node 22.18+ for the dependency-free input boundary tests.

- `reset.sql` — drops every table. **Wipes all data** — only run on purpose
- `seed.sql` — sample runners, chip results, per-km splits, FotoYu photo mapping

## Strava race matching storage

`20261101000100_strava_race_matching.sql` extends the preserved Strava lifecycle with four server-only tables. `strava_race_configs` has one row per category, with `start_time_from`/`start_time_to` as finite UTC instants (`timestamptz`), `allowed_sport_types = ['Run']`, and `distance_tolerance_m = 500`. The nullable `start_latitude`, `start_longitude`, and `start_radius_m` must be supplied together; radius may be zero. Category distance stays in `categories.distance_km`. No race window or coordinates are seeded by the migration; approved values must be configured before ingestion.

`strava_activity_candidates` keys each row by `(user_id, generation, runner_id, activity_id)` and also enforces uniqueness of `(generation, runner_id, activity_id)`. Foreign keys require current connection generation, runner access, and an existing activity detail. `strava_runner_activities` and `strava_live_metrics` each allow one row per runner. Live metrics reference that exact selection and contain only the five nullable numeric metrics. Demo `strava_metrics` remains separate.

These security-definer RPCs have empty search paths and may be executed only by `service_role`; they accept an already authenticated server-side user ID:

| RPC | Contract |
| --- | --- |
| `strava_begin_runner_oauth(p_user uuid, p_runner uuid, p_hash text, p_return_path text)` | Requires runner access and the exact local path `/wrapped/{runner UUID}`. Returns the existing begin status (`ready`, `already_connected`, `disconnecting`, or `in_progress`). Stores runner/path only on a ready attempt. |
| `strava_claim_runner_oauth(p_user uuid, p_hash text)` | Returns exactly `{status, runner_id, return_path, generation}`; never credentials. Delegates claim/replay handling to the lifecycle. Missing/foreign/legacy unbound state returns `invalid_state` and null context. |
| `strava_store_runner_candidates(p_user uuid, p_generation uuid, p_runner uuid, p_candidates jsonb)` | Upserts an array of `{activity_id, match_status, reason, summary}`. Status is `auto_match`, `needs_confirmation`, or `no_match`; summary is an object supplied by trusted server code with safe candidate fields. Empty arrays preserve existing candidates, allowing paginated discovery. `no_match` clears an existing selection for that activity. Returns void; obsolete generation raises `22023`, foreign runner `42501`, absent/deleted detail `23503`. |
| `strava_select_runner_activity(p_user uuid, p_generation uuid, p_runner uuid, p_activity text, p_metrics jsonb)` | Returns `selected`, `obsolete`, `forbidden`, or `invalid_candidate`. Rechecks current connection, access, and selectable candidate. Atomically replaces selection and all five metrics; absent metrics become null. Only `avg_heartrate`, `max_heartrate`, `elevation_gain_m`, `calories`, and `avg_cadence` are accepted, with numeric/null values; zero is valid. |
| `strava_clear_live_selection(p_user uuid, p_generation uuid)` | Clears selection/live metrics for the current generation only, preserving candidates. Returns void; a stale generation is a no-op. |

All mutations lock the same connection row as the lifecycle. Disconnect/reconnect, loss of active state, access removal, activity deletion, and changed activity details clear dependent selection/live metrics atomically. Generation changes clear candidates too. Existing lifecycle RPC names and token rotation/revocation behavior remain available.

Run the rollback-wrapped SQL assertions locally with an isolated PGlite installation outside the repository:

```powershell
$env:STRAVA_PGLITE_MODULE = 'C:/path/to/node_modules/@electric-sql/pglite/dist/index.js'
npm run test:native
```

The native harness creates minimal Auth roles and applies the complete migration chain before `tests/sql/strava-lifecycle.sql`. Without `STRAVA_PGLITE_MODULE`, that one database test skips. The opt-in `RUN_STRAVA_DATABASE_TESTS=1` Vitest suite adds real multi-request selection/disconnect races; run it only against a fully migrated dedicated project whose host matches `SUPABASE_DEMO_PROJECT_REF`. It creates disposable Auth/event/runner fixtures and cleans them up. An unconfigured or skipped remote suite does not establish remote database success.

Run `reset.sql` manually in the Supabase SQL Editor only when you intend to wipe the app data. Afterward, run the initial migration SQL there to recreate the schema; `db push` won’t reapply a migration already recorded as applied. The configured seed file is `db/seed.sql`.
