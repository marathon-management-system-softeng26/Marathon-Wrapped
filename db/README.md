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

- `reset.sql` — drops every table. **Wipes all data** — only run on purpose
- `seed.sql` — sample runners, chip results, per-km splits, FotoYu photo mapping

Run `reset.sql` manually in the Supabase SQL Editor only when you intend to wipe the app data. Afterward, run the initial migration SQL there to recreate the schema; `db push` won’t reapply a migration already recorded as applied. The configured seed file is `db/seed.sql`.
