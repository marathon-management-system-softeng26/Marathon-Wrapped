# Core foundation verification

Date: October 20, 2026 (Asia/Jakarta). Scope: the data/auth/API foundation, not completed prototype acceptance.

## Environment and setup

Windows PowerShell, Node 24.16.0, Next.js 16.3.6, Vitest 2.1.9; dedicated Supabase Postgres 17 project `anbnuegocddoowagqmxw` in Singapore, organization `buns project`. Production Next.js server uses local port 3007. Credentials stay in ignored `.env.local`/`.env.demo.local`, never in this record.

The original `npm ci` failed because the existing package lock omitted Supabase. The lock now matches pinned Supabase JS 2.118.0, SSR 0.12.7 and server-only 0.0.1; a clean `npm ci --offline --ignore-scripts --no-audit --no-fund` succeeded (404 packages). Intermittent DNS/transport failures delayed project creation, package installation and official documentation access; the new project was subsequently created and verified healthy. Docker was unavailable, so database checks used only this new dedicated project after verifying its public schema was empty.

## Evidence

| Check | Observed result |
| --- | --- |
| Existing statistics baseline | 22 Vitest tests passed after dependencies installed |
| New auth/controller/service/HTTP tests | Failed against missing or input-only implementation, then passed after implementation |
| `npm test` after organizer integration | 62 passed; 11 real-database tests deliberately skipped without opt-in |
| `npm run test:native` | 10 passed, including malformed split rejection, numeric conversion, private-field removal and observed-start regression |
| `npm run lint`; `npx tsc --noEmit` | Passed |
| `npm run build` | Production Turbopack build passed, including the protected dynamic API route |
| Initial schema view access probe | Anonymous view SELECT was allowed; view did not use invoker permissions |
| Follow-up schema view access probe | Anonymous SELECT revoked; `security_invoker=true` verified |
| `db/tests/core.sql` | Failed before seeding, passed after; reseed retained exactly 1 event and 8 runners |
| `db/tests/integrity.sql` | Passed competition ties, cross-distance isolation, changed-peer reranking, immutable BIB, duplicate-result, invalid split/pace, DNF and parental-consent assertions; mutations rolled back |
| `db/tests/lifecycle.sql` | Category-change regression failed before guard; passed after additive migration, with no-start DNF rejection; mutations rolled back |
| Live HTTP suite with real Auth sessions | 11 passed on the fresh production build with normal `npm run test:db`; includes organizer event access and create/update/duplicate rejection; no tests skipped |
| `db/tests/organizer.sql` | Failed before the RPC existed; passed create/update, late-error rollback, wrong-event/duplicate rejection and atomic category movement after migration; fixtures rolled back |
| Actual photo fixtures | Three BIB mappings to a visually inspected CC0 sample; uploaded to Supabase Storage and fetched successfully as image/jpeg; reseed preserves 8 runners, 3 photos and 3 complete heroes |

Live checks cover anonymous denial, runner A viewing A, A denied B, B viewing B, organizer DNF/DNS/missing-result access, no-Strava/no-photos baseline, no-store headers and direct anonymous Data API denial. They do not certify an organizer management screen or real Strava OAuth. Initial full-suite attempts timed out in two lifecycle tests at Vitest's 5-second timeout; isolated and diagnostic runs passed. After the review fixes and production rebuild, the unmodified normal suite passed 9/9, with shown recap checks at 332–556 ms. This is API correctness evidence, not a claim that the SRS 20-load performance target has passed.

## Independent review and fixes

A fresh read-only reviewer found no concrete authorization/cache bypass, but identified three important defects. Each received a failing regression before its fix: no-start rows could become DNF; category moves could rank stale results at a different distance; stalled optional queries could block baseline. The fixes require observed starts for non-DNS results, reject category changes with existing chip data, lock demo distances to 5K/10K, and abort optional queries after 1200 ms with a warning fallback. Historical migrations were not edited; the review fixes have a new migration.

## Advisor findings

No security error was reported. The [RLS-without-policy informational finding](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) is intentional for this server-only access model: browser grants are revoked and verified server guards authorize every privileged route. [Unused-index information](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index) is expected on the tiny new dataset; keep foreign-key indexes. Supabase reports [leaked-password protection disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection); no paid upgrade was authorized. Demo accounts use a generated random password.

## Remaining acceptance

Provider OAuth/refresh/disconnect, organizer management UI, login/selection and card UI, actual image exports and responsive/accessibility/browser checks remain. Transactional organizer APIs and full chip/demo-metric/photo hero fixtures now exist. The SRS 19-of-20 loads within 3 seconds has not been run. No production release, main-branch merge or complete SRS acceptance is claimed.

## Organizer and photo increment

Organizer draft validation and HTTP tests failed before implementation and now pass (16 tests). Real-session tests confirm that a runner cannot read organizer event results, an organizer sees all eight fixtures including result-unavailable, and a disposable QA record can be created/updated while a duplicate BIB is rejected. QA-created data is deleted using its exact generated ID/BIB; seed fixtures are not removed. An internal-host versus incoming-Host origin-check defect was reproduced in unit and live tests, then fixed while preserving cross-origin write denial.

A separate source review found no important defect in the organizer increment. Its limits were lack of independent DB execution, concurrency testing and result sets above the Data API page limit; this eight-runner prototype stays below that limit. SQL aggregate tests independently establish rollback after an error occurring after the original result/splits were replaced.

Photo provenance is recorded in [PROVENANCE.md](../../public/photos/PROVENANCE.md). The shared group photo is a labeled stock sample, never a real match of the pictured people to synthetic runners. The first Storage bootstrap attempt failed; retry succeeded, public image retrieval was checked, and manual mappings were updated to the owned Storage URL. No existing private bucket was made public.
