# Integrated dev comparison with the PRD

**Date:** November 10, 2026  
**Integrated branch:** `codex/integrate-all-into-dev`  
**Base:** `origin/dev` (`d82a4fa`)  
**Application tree reviewed:** `e0c48d4`, with final recovery fixes at `4f9993f`  
**Authority:** `PRODUCT.md`, `docs/SRS_v4.md`, and `docs/requirements-register.md`

This report records the November 10 integration against the requirements in effect that day. The November 11 decision supersedes chip-first Wrapped generation and the runner workflow below. Follow the [acceptance matrix](acceptance-matrix.md) for the current checks.

## Historical scope reconciliation

The apparent Strava conflict in the pre-integration `PRODUCT.md` is resolved by the merged requirements history. The October 20 disconnected-only decision was superseded on November 2 by an approved complete opt-in integration. The integrated application is therefore graded against runner-bound OAuth, activity selection, five nullable metrics, fallback, and disconnect behavior. Real-provider acceptance remains deferred.

## PRD comparison

| PRD outcome or constraint | Status | Evidence |
| --- | --- | --- |
| Verified sessions and server-owned runner/event mappings protect personal and organizer data | Met in implementation | `lib/auth/session.ts`, `lib/auth/access.ts`, guarded runner/organizer APIs, and API authorization tests |
| Superseded chip-first rule kept chip data as the baseline when enrichment failed | Met | `lib/wrappedService.ts` falls back to the chip recap; Strava, missing-photo, timeout, and post-OAuth queue-failure paths are covered by automated tests |
| Missing timing is not invented; finisher, DNF, DNS, and missing-result states remain distinct | Met | Native input validation, `lib/insights.ts`, `lib/shareModel.ts`, and wrapped-service tests preserve null finish/pace values and distinct states |
| Hydration is not inferred | Met | No hydration behavior exists in the product code; SRS v4 explicitly keeps it outside scope |
| Demo metrics and stock photos are identified as demonstrations | Met | Strava demo state says "Seeded sample metrics" and exports identify synthetic race data; demo/live provenance has automated coverage |
| Runner can sign in and reach only an authorized recap | Met in implementation; remote E2E not rerun | Session and runner-access guards are tested locally. The credential-dependent Supabase flow is skipped in this worktree |
| Runner can understand splits and race state | Met | Stats/insight suites cover split calculations, fastest kilometer, comparison text, and non-finisher states |
| Runner can inspect matched photos and continue with no photos | Met | Exact-BIB matching, multiple-photo, and empty-photo behavior are implemented and recorded in the acceptance matrix |
| Runner can export a correct 1080 x 1350 PNG | Met | `lib/exportWrapped.ts` fixes canvas dimensions and PNG output; automated failure/privacy tests and previously inspected browser downloads are recorded |
| Organizer can view results and create/update hero runners within an authorized event | Met in implementation; remote E2E not rerun | Guarded organizer APIs, atomic aggregate save, validation, rejection, and correction paths have automated coverage |
| No public personal recap links | Met | `/wrapped/[runnerId]` is backed by a private, no-store API requiring both a verified session and runner access; no personalized-link service is implemented |
| Local Figma Make export remains uncommitted | Met | No `ui reference` path is tracked by Git |
| Full voluntary Strava connect/select/metrics/disconnect workflow | Partial acceptance | Automated route, service, privacy, matching, fallback, and lifecycle coverage passes. Missing-result recaps preserve owner status/disconnect controls, and queue failures return to a durable retry action. Real-provider consent/import/revocation acceptance is still pending |

## Verification performed on the integrated tree

- `npm test`: 336 passed; 17 credential-dependent integration tests skipped.
- `npm run test:native`: 10 passed; 1 optional PostgreSQL/PGlite test skipped.
- `npm run lint`: passed.
- `npm run build`: passed, including TypeScript and production page generation.
- Every surviving local and remote branch tip is an ancestor of the integrated branch.

## Acceptance gaps recorded on November 10

1. Run real Strava consent, callback, activity import, reconnect, provider denial, and revocation checks with a dedicated test application.
2. Run the Supabase lifecycle/concurrency and authenticated end-to-end suites against a dedicated non-production project.
3. Configure and exercise the Strava webhook subscription and scheduled worker path.
4. Complete manual desktop/mobile browser acceptance for focus, responsive layout, action counts, no-photo/missing-result states, and export failure injection.
5. Confirm browser support, account-wide free-tier headroom, and the remaining everyday-language glossary review.
6. Close or update SRS v4 decisions OD-01, OD-02, OD-03, OD-04, OD-06, OD-07, and OD-08 where the implementation has already selected behavior but the requirements document still calls the decision open.

## Integration note

`origin/dev-harry` contributes a legacy `Docs/database_schema.sql` and Week 2 documentation. They are retained to satisfy full branch-history integration, but current schema authority remains the ordered migrations under `supabase/migrations/`.
