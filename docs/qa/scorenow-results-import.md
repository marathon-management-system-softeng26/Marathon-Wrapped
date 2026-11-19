# ScoreNow results import QA — 2026-11-19

## Scope and provenance

- Source: [ScoreNow — Soekarno Run 2026 results](https://results.scorenow.co.id/results.aspx?CId=19723&RId=308)
- Source race date: `2026-02-15`
- Capture timestamp: `2026-11-19T03:23:05.244Z`
- Competition/race identifiers: `19723` / `308`
- Capture coverage: all 80 10K pages and all 120 5K pages

Direct non-browser HTTP requests received a Cloudflare 403 challenge. The source pages were therefore captured through the user-authorized Edge session, saved under ignored `.data/scorenow/pages/`, and passed through the same deterministic parser and whole-dataset validator. The normalized artifact is ignored at `.data/scorenow/soekarno-run-2026.json`; no participant rows are copied into this document or Git.

## Verified dataset

| Invariant | Observed |
| --- | ---: |
| Total rows | 9,982 |
| 10K rows | 3,995 |
| 5K rows | 5,987 |
| Distinct source UIDs | 9,982 |
| Ranked 10K rows / max position | 3,140 / 3,140 |
| Ranked 5K rows / max position | 4,659 / 4,659 |
| Rows with a null required field | 0 |
| Literal blank source names | 22 |
| Minimum / maximum race date | `2026-02-15` / `2026-02-15` |

The source publishes 855 unranked 10K rows and 1,328 unranked 5K rows without official position/time or category/gender ranks. Those values are stored as null rather than fabricated. Some of those unranked entries have no published name; all 22 remain non-null empty strings so the import preserves the source total and provenance.

## Storage and import boundary

The rows are stored in `public.scorenow_results` in dedicated Supabase project `anbnuegocddoowagqmxw`. They are not inserted into trusted `runners` or legacy `chip_results`. The staging table has RLS enabled, explicit browser-role revokes, service-role grants, source-key and ranked-position uniqueness, paired nullable time/rank checks, and JSON-array checkpoint validation.

Import used `public.import_scorenow_results(jsonb)` in 125-row calls (the final call contained 107 rows). Every RPC result matched its input count. Re-importing a 125-row sample returned 125 affected rows while the table remained at 9,982 rows, proving source-key idempotency. `tests/sql/scorenow-result-import.sql` independently checks catalog permissions, blank-name preservation, and rollback-wrapped upsert idempotency.

## Verification evidence

Repository gates run after the import:

- `npm test`: 653 passed, 21 environment-gated integration tests skipped.
- `npm run test:native`: 35 passed, 1 PostgreSQL/PGlite test skipped because `STRAVA_PGLITE_MODULE` was not configured.
- `npm run lint`: passed.
- `npx tsc --noEmit`: passed after Next.js type generation.
- `npm run build`: production build passed and generated all routes.

Supabase catalog checks confirmed RLS enabled; no `anon` or `authenticated` table/RPC privilege; `service_role` table and RPC access; invoker security; and `search_path = ''`.

Post-migration advisors reported:

- Health: no findings.
- Security: the server-only table is included in the intentional `RLS enabled, no policy` informational group (21 tables total). Browser privileges are explicitly revoked. The existing project-level leaked-password-protection warning remains; see [Supabase password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
- Performance: four existing unindexed Strava foreign-key findings and two existing unused-index findings; none reference `scorenow_results`. See the [Supabase database linter reference](https://supabase.com/docs/guides/database/database-linter).

## Limitations

- The browser capture is a point-in-time snapshot and must be repeated if ScoreNow changes results.
- Source names, bibs, timing, ranks, and checkpoints are public organizer data, not verified identities.
- No registration email, phone, date of birth, identity number, consent, application user ID, or runner ownership is inferred or stored.
- The ignored local artifact contains public participant result rows and should be handled as data, not source code.
