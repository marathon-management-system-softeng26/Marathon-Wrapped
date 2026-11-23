# SDD ledger — plan: docs/superpowers/plans/2026-11-18-official-results-bib-registration.md

Ruling: ship the secure BIB-first MVP on the existing feature checkout — the prior global BIB-only claim path remains for legacy events, while new editions use event-scoped published results and ticketed RPCs; cost if wrong is migration follow-up for legacy data.

Task 1: complete — official identity migration, runner/photo ownership backfill, shared result types, and SQL coverage added; targeted PGlite/database checks passed.
Task 2: complete — reused the existing validated ScoreNow parser/scraper/import foundation; no duplicate parser was introduced.
Task 3: complete — staged import tables, bounded staging RPC, and atomic publication RPC added; publication SQL checks passed in the isolated database harness.
Task 4: complete — hashed preview/acceptance tickets, roster-bound reservations, server-only RPC contracts, expiry and rate limiting added.
Task 5: complete — BIB lookup/accept/link routes, signup/login reservation flow, registration UI, and dashboard recovery link added.
Task 6: complete — official payload composition and owner-only wrapped route added with optional Strava enrichment and runner-scoped photos.

Final review: self-review — no separate reviewer slot was available; full Vitest, native tests, lint, typecheck, build, and diff-check were run.
