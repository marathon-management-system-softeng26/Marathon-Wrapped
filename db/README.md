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

`db/seed.sql` is transactional and repeatable for eight synthetic BIB fixtures in the Soekarno Run 2027 demo. It uses August 17, 2027 as a fixture date, not a confirmed real event schedule. Three hero runners have chip results and clearly marked demo Strava metrics. Matched photo assets remain a later delivery item; this is not yet a complete hero-photo dataset.

For Auth bootstrap, configure the documented variables in ignored `.env.local`, including an explicit matching `SUPABASE_DEMO_PROJECT_REF`, then run `npm run seed:users`. It creates two synthetic runner accounts and an event-scoped organizer, saving generated credentials to ignored `.env.demo.local`. Do not use this workflow on a production or unrelated project.

Run `npm run build`, then `npm run start -- --port 3007` in one terminal and `npm run test:db` in another for real-session HTTP acceptance. `npm test` deliberately skips the database suite unless opted in; skipped tests are not evidence of database success. `db/tests/core.sql`, `integrity.sql` and `lifecycle.sql` contain additional SQL assertions; mutation checks roll back their changes. Run `npm run test:native` on Node 22.18+ for the dependency-free input boundary tests.

- `reset.sql` — drops every table. **Wipes all data** — only run on purpose
- `seed.sql` — sample runners, chip results, per-km splits, FotoYu photo mapping

Run `reset.sql` manually in the Supabase SQL Editor only when you intend to wipe the app data. Afterward, run the initial migration SQL there to recreate the schema; `db push` won’t reapply a migration already recorded as applied. The configured seed file is `db/seed.sql`.
