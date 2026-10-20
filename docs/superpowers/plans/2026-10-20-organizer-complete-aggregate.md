# Complete organizer aggregate

Execute inline with superpowers:executing-plans. Completion audit found OD-07 explicitly includes optional metrics and photo mappings; the chip-only checkpoint did not discharge this requirement.

- [x] Add validated optional enrichment to HeroRunnerDraft. Absent field preserves optional records for old API callers; an explicit enrichment replaces them atomically. Metrics are synthetic demo values only. Photo URLs must belong to this configured Supabase race-photos bucket. Reject nonfinite/out-of-range values, foreign origins and unsupported fields. RED/GREEN validator tests.
- [x] Extend guarded draft retrieval with whitelisted sample metrics/photo fields. Reject editing live-provider metrics through this demo interface. No provider tokens appear.
- [x] Extend service-only save_hero_runner in a CLI-generated migration. Keep existing event/identity/result guards and restore everything on late optional validation failure. Add transactional SQL and live HTTP create/update/rollback tests; preserve absent-field compatibility.
- [x] Add optional sample metric/photo fields to the existing organizer form, clearly labeled and consistent with existing controls. Retain current draft on error. Re-run checks and final browser/visual review after changes.

Files: lib/heroValidation.ts, lib/organizerEnrichment.ts, controllers/organizerController.ts, organizer component and a focused enrichment editor, migration, db/tests/organizer-enrichment.sql, tests. No real Strava OAuth is introduced; the user's disconnected-state decision remains intact.
