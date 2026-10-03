# /db — Database

Owner: **Rakha** (data) · Postgres on Supabase

Planned:

- `schema.sql` — tables and the `runner_wrapped` view (safe to re-run; no `drop table`)
- `reset.sql` — drops every table. **Wipes all data** — only run on purpose
- `seed.sql` — sample runners, chip results, per-km splits, FotoYu photo mapping

Committing these files does **not** change the database. They only take effect when someone runs them in the Supabase SQL Editor.
