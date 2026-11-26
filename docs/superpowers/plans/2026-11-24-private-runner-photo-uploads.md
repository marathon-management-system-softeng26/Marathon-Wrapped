# Private Runner Photo Uploads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a directly owning runner privately upload at most three race photos, choose which appear in the Wrapped photo scene, and revoke access immediately after deletion or ownership release.

**Architecture:** PostgreSQL owns the three-slot lifecycle and all crash-recovery fences; a private Supabase Storage bucket accepts only server-authorized staging uploads. Next.js normalizes images into opaque ready objects, proxies every read through a fresh ownership check, and merges selected personal photos once at the outer Wrapped API boundary.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase Postgres/Storage and `@supabase/supabase-js` 2.118.0, exact `sharp` 0.35.5, Vitest/jsdom, Node native tests, PostgreSQL SQL assertions.

**Spec:** `docs/superpowers/specs/2026-11-24-private-runner-photo-uploads-design.md`

## Global Constraints

- Keep the existing public `race-photos` bucket and organizer/FotoYu records unchanged; personal files live only in private `runner-photos`.
- Accept only JPEG, PNG, or WebP input from 1 through 5,242,880 bytes; decode structurally, reject excessive pixels, auto-orient, strip metadata, fit within 4096 × 4096 without enlargement, and output WebP.
- Count every live `pending`, `finalizing`, and `ready` row toward the maximum of three photos for one `(user_id, runner_id)`.
- Authorize personal-photo operations only through the exact `runner_access(user_id, runner_id)` owner; never call organizer-capable `requireRunnerAccess`.
- Object paths are opaque random staging/ready paths and never contain user ID, runner ID, BIB, or original filename; never reuse a path.
- Browser roles receive no photo-table policy or broad Storage policy. The browser receives only one signed staging-upload capability and never a ready path or read capability.
- Serve ready bytes only from the authenticated content route with `Cache-Control: private, no-store`, `Pragma: no-cache`, and `X-Content-Type-Options: nosniff`.
- A read authorized after deletion or ownership-release commit must fail generically; already-authorized bytes in flight cannot be recalled.
- Selected personal photos appear before organizer/FotoYu photos only in the Wrapped photo scene. `SharePreview` and `exportWrapped` remain photo-free.
- Keep all user-facing controls usable at 320 CSS px, keyboard accessible, and honest about pending/finalizing/error states.
- Do not apply a remote migration, create a production bucket, configure a scheduler, deploy, push, or merge without explicit authorization at execution time.

## Review Focus

- Crash between reserve, signed-token mint, and activation: Task 1 SQL tests and Task 2 service tests must prove conservative expiry and scheduled reclamation.
- Delete/release while normalization is writing: Task 1 and Task 2 must prove one-writer leases, stale-writer fencing, and delayed provisional cleanup.
- Simultaneous fourth upload: Task 1 must prove the runner-row lock makes exactly one competing reservation fail.
- Forged MIME, corrupt/polyglot input, oversized dimensions, or EXIF location: Task 2 must exercise real decoding, pixel/output ceilings, and metadata stripping.
- Official, legacy, and Strava-ready payloads: Task 6 must prove personal photos merge exactly once, organizer order remains stable, failures do not hide statistics, and export never consumes photos.

---

### Task 1: Add the private bucket and transactional photo lifecycle

**Files:**
- Create: `tests/sql/runner-photo-uploads.sql`
- Create: `tests/native/runner-photo-database.test.mts`
- Create: `supabase/migrations/<CLI timestamp>_private_runner_photo_uploads.sql` using the pinned CLI command below

**Interfaces:**
- Consumes: existing `public.runner_access(user_id, runner_id)` ownership and its delete lifecycle
- Produces: private `runner-photos` bucket; `runner_uploaded_photos`; `runner_photo_cleanup`; reserve/activate/prepare/finalize/select/delete/sweep/claim/ack/fail RPCs for Task 2

- [ ] **Step 1: Write failing SQL assertions**

In `tests/sql/runner-photo-uploads.sql`, assert bucket privacy/limits/MIME allowlist; table constraints/indexes/RLS/grants; direct-owner-only functions; organizer denial; three-slot enforcement including `finalizing`; concurrent fourth reservation refusal; conservative unactivated expiry; activation expiry; one live finalization writer; stale lease fencing; finalizing-to-pending recovery; atomic staging tombstone on finalize; selection; idempotent delete/finalize; ownership-cascade jobs; safety-bounded staging/provisional cleanup; committed-ready immediate cleanup; leased claim/ack/fail/backoff; and no `anon`/`authenticated` table or function privileges.

- [ ] **Step 2: Add the native PostgreSQL harness and verify failure**

Create `tests/native/runner-photo-database.test.mts` following `tests/native/strava-database.test.mts`: build minimal `auth` and `storage` schemas, apply required core migrations, apply the photo migration when present, then execute `tests/sql/runner-photo-uploads.sql`. Use `RUNNER_PHOTO_PGLITE_MODULE` as the optional runtime variable.

Run: `$env:RUNNER_PHOTO_PGLITE_MODULE='<external-pglite-entry>'; npm run test:native`

Expected: FAIL because the bucket, tables, and RPCs do not exist.

- [ ] **Step 3: Generate the migration with the current pinned CLI**

Run: `npx --yes supabase@3.3.0 migration new private_runner_photo_uploads`

Expected: one new timestamped file under `supabase/migrations/`; use that generated path for the remainder of this task.

- [ ] **Step 4: Define bucket, tables, indexes, and cleanup trigger**

In the generated migration, add a fail-closed `storage.buckets` preflight/insert for `runner-photos` with `public=false`, `file_size_limit=5242880`, and `allowed_mime_types=array['image/jpeg','image/png','image/webp']`. Define `runner_uploaded_photos` with exact-owner composite cascade FK, unique staging/ready paths, `pending|finalizing|ready` state, input/ready metadata constraints, inclusion flag, conservative/token/lease timestamps and lease ID. Define `runner_photo_cleanup` with `staging|provisional_ready|ready`, `not_before`, claim lease, attempts, and bounded error code; add FK-leading, quota/list, expiry, and due-job indexes plus the delete trigger.

- [ ] **Step 5: Implement the transactional RPC contract**

Create invoker-rights, `search_path=''`, service-role-only functions with these signatures:

- `reserve_runner_photo_upload(uuid,uuid,text,bigint,timestamptz) -> table(photo_id uuid,staging_object_path text)`
- `activate_runner_photo_upload(uuid,uuid,uuid,timestamptz) -> boolean`
- `prepare_runner_photo_ready(uuid,uuid,uuid,timestamptz) -> table(ready_object_path text,lease_id uuid,lease_expires_at timestamptz)`
- `finalize_runner_photo_upload(uuid,uuid,uuid,text,uuid,bigint) -> boolean`
- `set_runner_photo_included(uuid,uuid,uuid,boolean) -> boolean`
- `delete_runner_photo(uuid,uuid,uuid) -> boolean`
- `sweep_runner_photo_uploads(timestamptz) -> integer`
- `claim_runner_photo_cleanup(integer,integer) -> table(job_id uuid,object_path text,object_kind text,lease_id uuid)`
- `ack_runner_photo_cleanup(uuid,uuid) -> boolean`
- `fail_runner_photo_cleanup(uuid,uuid,text,integer) -> boolean`

Use runner-row then photo-row lock order everywhere. Finalize must fence on both ready path and lease ID and enqueue the staging tombstone in the same transaction. An expired finalization lease returns to activated pending while its upload remains valid, otherwise expires the reservation. Revoke from `PUBLIC`, `anon`, and `authenticated`; grant only the required table access and function execution to `service_role`.

- [ ] **Step 6: Run database verification**

Run: `$env:RUNNER_PHOTO_PGLITE_MODULE='<external-pglite-entry>'; npm run test:native`

Expected: PASS for `runner-photo-database.test.mts` and all existing native tests; if the external module is absent, record the skip and run the SQL against the disposable local/linked test project before Task 7.

- [ ] **Step 7: Commit the database slice**

```bash
git add supabase/migrations/*_private_runner_photo_uploads.sql tests/sql/runner-photo-uploads.sql tests/native/runner-photo-database.test.mts
git commit -m "feat: add private runner photo storage lifecycle"
```

### Task 2: Build the server-side upload and normalization service

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `lib/runnerPhotos/types.ts`
- Create: `lib/runnerPhotos/validation.ts`
- Create: `lib/runnerPhotos/store.ts`
- Create: `lib/runnerPhotos/storage.ts`
- Create: `lib/runnerPhotos/service.ts`
- Create: `tests/runnerPhotoService.test.ts`

**Interfaces:**
- Consumes: Task 1 RPCs and private `runner-photos` bucket
- Produces: safe `RunnerPhotoSlot`/`RunnerPhotoUploadCapability` DTOs and list/included-list/begin/complete/toggle/delete/content service functions for Tasks 3, 5, and 6

- [ ] **Step 1: Install the pinned decoder**

Run: `npm install --save-exact sharp@0.35.5`

Expected: `package.json` and `package-lock.json` pin `sharp` exactly; it is a production dependency.

- [ ] **Step 2: Define shared DTOs and pure validation tests**

Define `RunnerPhotoState = 'pending'|'finalizing'|'ready'`, `RunnerPhotoSlot = {id,state,included,createdAt,expiresAt:string|null,contentUrl:string|null}`, and `RunnerPhotoUploadCapability = {photoId,path,token,expiresAt}`. Test that `parseUploadDeclaration(unknown)` accepts only `{mimeType:'image/jpeg'|'image/png'|'image/webp',sizeBytes:1..5242880}` and that UUID/boolean inputs fail without leaking internals.

Run: `npm test -- tests/runnerPhotoService.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement database and Storage adapters**

In `store.ts`, wrap every Task 1 RPC and direct-owner list/read lookup; map database rows to safe DTOs without object paths. In `storage.ts`, export signed staging creation, `info`, bounded download, normalized upload, ready download, and removal helpers. Use `createSignedUploadUrl(stagingPath, { upsert: false })`; never log token/path values.

- [ ] **Step 4: Implement structural normalization**

Export `normalizeRunnerPhoto(input: Uint8Array): Promise<{bytes:Buffer;mimeType:'image/webp';sizeBytes:number}>`. Use `sharp` with fail-on decode errors, a fixed input-pixel ceiling consistent with the 4096 × 4096 output cap, `rotate()`, metadata stripping by omission, `resize({width:4096,height:4096,fit:'inside',withoutEnlargement:true})`, and WebP output. Reject zero bytes, >5 MiB input/output, animated/multipage input, malformed data, and decoded dimensions beyond the ceiling.

- [ ] **Step 5: Implement crash-safe orchestration**

Export:

- `listRunnerPhotos(userId:string,runnerId:string): Promise<RunnerPhotoSlot[]>`
- `listIncludedRunnerPhotos(userId:string,runnerId:string): Promise<RunnerPhotoSlot[]>`
- `beginRunnerPhotoUpload(userId:string,runnerId:string,input:unknown): Promise<RunnerPhotoUploadCapability>`
- `completeRunnerPhotoUpload(userId:string,runnerId:string,photoId:string): Promise<RunnerPhotoSlot>`
- `setRunnerPhotoIncluded(userId:string,runnerId:string,photoId:string,included:boolean): Promise<RunnerPhotoSlot>`
- `deleteRunnerPhoto(userId:string,runnerId:string,photoId:string): Promise<void>`
- `readRunnerPhoto(userId:string,runnerId:string,photoId:string): Promise<Uint8Array>`

Reserve before signing, activate with the actual two-hour token expiry, preserve the conservative tombstone on signing/activation failure, prepare a unique lease before writing normalized bytes, allow one writer, finalize with path+lease fencing, and queue/remove only through the durable cleanup contract. Map missing/foreign rows to one generic not-found error.

- [ ] **Step 6: Exercise real image and crash boundaries**

Test valid JPEG/PNG/WebP normalization, EXIF removal, orientation, 4096 cap, malformed/polyglot/animated/excessive-pixel/output rejection, reserve→sign failure, sign→activate failure, prepare→write failure, write→finalize failure, competing completion, expired-lease recovery, organizer-only denial, and safe DTOs with no ready path. Mock Supabase network calls but use real `sharp` buffers for decoder assertions.

Run: `npm test -- tests/runnerPhotoService.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the service slice**

```bash
git add package.json package-lock.json lib/runnerPhotos tests/runnerPhotoService.test.ts
git commit -m "feat: add secure runner photo upload service"
```

### Task 3: Expose authenticated management and content routes

**Files:**
- Create: `app/api/runners/[runnerId]/photos/route.ts`
- Create: `app/api/runners/[runnerId]/photos/[photoId]/route.ts`
- Create: `app/api/runners/[runnerId]/photos/[photoId]/complete/route.ts`
- Create: `app/api/runners/[runnerId]/photos/[photoId]/content/route.ts`
- Create: `lib/runnerPhotos/http.ts`
- Create: `tests/api/runnerPhotos.test.ts`

**Interfaces:**
- Consumes: Task 2 service and existing `requireUser`, `sameOrigin`, `boundedJson`, `privateHeaders`, `isRunnerId`
- Produces: private GET/list/content and same-origin POST/PATCH/DELETE HTTP contract consumed by Task 5

- [ ] **Step 1: Write failing boundary tests**

Cover unauthenticated 401; malformed IDs before storage access; organizer/missing/foreign generic 404; wrong origin 403; oversized/malformed JSON 400; unsupported MIME/size 400; concurrent fourth upload 409; upload capability response; pending/finalizing list safety; complete/toggle/delete; private headers on every response; and generic 503 without secret/path/token leakage.

For content, assert WebP bytes plus `Content-Type: image/webp`, `Content-Length`, private/no-store, pragma no-cache, nosniff, and identical 404 after deletion/release or cross-owner access.

Run: `npm test -- tests/api/runnerPhotos.test.ts`

Expected: FAIL because the routes do not exist.

- [ ] **Step 2: Implement shared HTTP error mapping**

In `lib/runnerPhotos/http.ts`, centralize UUID validation, same-origin write enforcement, bounded body parsing, and mappings for authentication, not-found, validation, quota/in-progress conflict, and temporary infrastructure failure. Responses must never include Storage or SQL messages.

- [ ] **Step 3: Implement list/upload/item/complete routes**

`GET|POST /api/runners/[runnerId]/photos` lists slots or begins upload. `PATCH|DELETE /api/runners/[runnerId]/photos/[photoId]` changes `{included}` or deletes/cancels. `POST .../[photoId]/complete` normalizes/finalizes. Set `dynamic='force-dynamic'` and private headers; writes require same origin and bounded JSON.

- [ ] **Step 4: Implement the authenticated content proxy**

`GET .../[photoId]/content` must call `requireUser`, validate exact ownership and ready tuple on every request, download with the service-role client, and stream bytes with the specified privacy headers. Never redirect to or sign a Storage read URL.

- [ ] **Step 5: Run focused API tests**

Run: `npm test -- tests/api/runnerPhotos.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the HTTP slice**

```bash
git add app/api/runners lib/runnerPhotos/http.ts tests/api/runnerPhotos.test.ts
git commit -m "feat: add private runner photo endpoints"
```

### Task 4: Add durable global cleanup processing

**Files:**
- Create: `lib/runnerPhotos/cleanup.ts`
- Create: `app/api/internal/runner-photos/process/route.ts`
- Create: `tests/runnerPhotoCleanup.test.ts`
- Create: `tests/api/runnerPhotoCleanup.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 1 sweep/claim/ack/fail RPCs and Task 2 Storage removal helper
- Produces: `processRunnerPhotoCleanup(options?:{batchSize?:number}): Promise<{swept:number;processed:number}>` and bearer-protected scheduled endpoint

- [ ] **Step 1: Write failing worker tests**

Test sweep-before-claim even with an empty outbox; bounded `FOR UPDATE SKIP LOCKED` claims; no database lock held across Storage calls; not-found success only after safety bound; delete success ACK; retryable failure safe-code/backoff; expired lease reclaim; batch bound; and one failed job not blocking the rest.

Run: `npm test -- tests/runnerPhotoCleanup.test.ts tests/api/runnerPhotoCleanup.test.ts`

Expected: FAIL because the worker does not exist.

- [ ] **Step 2: Implement the cleanup processor**

Sweep unactivated pending, upload-expired pending, and lease-expired finalizing rows before claiming due cleanup jobs. Remove only each claimed opaque path from `runner-photos`; ACK Storage success/not-found and fail with a bounded code plus exponential backoff. Never print object paths, tokens, or user identifiers.

- [ ] **Step 3: Implement the internal scheduled route**

Follow `app/api/internal/strava/process/route.ts`: `maxDuration=60`, timing-safe `Authorization: Bearer <RUNNER_PHOTO_PROCESS_SECRET>`, private response, 401 for wrong length/value, 503 if unconfigured, and a bounded worker invocation.

- [ ] **Step 4: Document the operational contract**

Add `RUNNER_PHOTO_PROCESS_SECRET` to the README environment table and document a periodic same-host POST to `/api/internal/runner-photos/process`. State that the schedule is mandatory for abandoned-upload recovery and that secret values never belong in URLs, logs, or `NEXT_PUBLIC_*` variables.

- [ ] **Step 5: Verify and commit**

Run: `npm test -- tests/runnerPhotoCleanup.test.ts tests/api/runnerPhotoCleanup.test.ts`

Expected: PASS.

```bash
git add lib/runnerPhotos/cleanup.ts app/api/internal/runner-photos/process/route.ts tests/runnerPhotoCleanup.test.ts tests/api/runnerPhotoCleanup.test.ts README.md
git commit -m "feat: process runner photo cleanup jobs"
```

### Task 5: Build the flexible three-slot photo manager

**Files:**
- Create: `app/runners/[runnerId]/photos/page.tsx`
- Create: `app/components/RunnerPhotoManager.tsx`
- Modify: `app/components/RacePassCard.tsx`
- Modify: `app/components/RecapStory.tsx`
- Modify: `app/globals.css`
- Create: `tests/runnerPhotoManager.test.ts`
- Modify: `tests/runnerWorkflow.test.ts`
- Modify: `tests/recapStory.test.ts`

**Interfaces:**
- Consumes: Task 2 DTOs and Task 3 HTTP endpoints; browser uses `createSupabaseBrowser().storage.from('runner-photos').uploadToSignedUrl(path,token,file,{contentType:mimeType})`
- Produces: `/runners/[runnerId]/photos`, three persistent slots, inclusion controls, and race-card/Wrapped entry links

- [ ] **Step 1: Write failing component and journey tests**

Assert three slots; JPEG/PNG/WebP accept hint; client 5 MiB guard; upload sequence begin→signed upload→complete→reload; duplicate-submit prevention; pending/finalizing reload states; retry complete; cancel/delete; include toggle with rollback on failure; all-zero selection; generic failure copy; object URL cleanup; and ready thumbnails through application content URLs only.

Update runner-card tests so there remains exactly one primary journey action plus a clearly secondary `Manage photos` link on every owned registration. Update recap tests so `Manage my photos` appears in both populated and empty photo scenes.

Run: `npm test -- tests/runnerPhotoManager.test.ts tests/runnerWorkflow.test.ts tests/recapStory.test.ts`

Expected: FAIL before the manager and links exist.

- [ ] **Step 2: Implement the manager page and upload state machine**

Render the existing application shell conventions with three stable slots. Fetch with `cache:'no-store'`; use an abort controller; upload directly with the signed staging token; call complete; expose Include/Delete or Cancel/Retry according to state; default new ready photos to included; keep controls disabled only for the active slot operation; and announce progress/errors with accessible status/alert regions.

- [ ] **Step 3: Add entry links without competing with the primary journey**

Add secondary `Manage photos` to `RacePassCard`. Add `Manage my photos` to the Wrapped photo scene whether photos exist or not. Preserve Strava and Wrapped primary action labels and `aria-describedby` context.

- [ ] **Step 4: Add responsive styles**

Use existing cream/deep/red/lime tokens. At 320 px, use one-column full-width slots and 44 px minimum interactive targets; grow to a three-column manager when space allows. Preserve long-name wrapping, safe-area padding, keyboard focus visibility, reduced-motion behavior, and the existing Wrapped scene layout.

- [ ] **Step 5: Run UI tests and commit**

Run: `npm test -- tests/runnerPhotoManager.test.ts tests/runnerWorkflow.test.ts tests/recapStory.test.ts`

Expected: PASS.

```bash
git add app/runners app/components/RunnerPhotoManager.tsx app/components/RacePassCard.tsx app/components/RecapStory.tsx app/globals.css tests/runnerPhotoManager.test.ts tests/runnerWorkflow.test.ts tests/recapStory.test.ts
git commit -m "feat: add runner photo manager"
```

### Task 6: Merge selected personal photos into Wrapped once

**Files:**
- Modify: `lib/wrappedPayload.ts`
- Modify: `controllers/enrichmentController.ts`
- Modify: `lib/officialWrappedService.ts`
- Create: `lib/runnerPhotos/wrapped.ts`
- Modify: `app/api/runners/[runnerId]/wrapped/route.ts`
- Modify: `app/components/RecapStory.tsx`
- Create: `tests/runnerPhotoWrapped.test.ts`
- Modify: `tests/api/wrapped.test.ts`
- Modify: `tests/officialWrappedService.test.ts`
- Modify: `tests/recapViewModel.test.ts`
- Modify: `tests/exportWrapped.test.ts`

**Interfaces:**
- Consumes: Task 2 `listIncludedRunnerPhotos` and Task 3 authenticated content URL
- Produces: `mergePersonalRunnerPhotos(payload:RunnerWrappedPayload,photos:Photo[]): RunnerWrappedPayload`

- [ ] **Step 1: Write failing merge and regression tests**

Test selected ready personal rows only; upload order; personal-before-organizer order; `source:'personal'|'organizer'`; nullable personal BIB/photographer fields; exactly-once merge for official, legacy-official, and Strava-ready payloads; no merge into non-ready workflow states; personal lookup failure returns the original payload; cross-owner URLs never enter payloads; missing/corrupt personal image leaves statistics and organizer photos visible; and deselecting all removes only personal photos.

Add an export regression proving `exportWrapped` neither fetches nor draws personal content URLs and still emits the 1080 × 1350 statistics card.

Run: `npm test -- tests/runnerPhotoWrapped.test.ts tests/api/wrapped.test.ts tests/officialWrappedService.test.ts tests/recapViewModel.test.ts tests/exportWrapped.test.ts`

Expected: FAIL before the merge adapter exists.

- [ ] **Step 2: Make photo provenance explicit**

Change `Photo` so `bib_number` is nullable and `source` is required. Map existing FotoYu/organizer query results to `source:'organizer'`; map personal rows to `source:'personal'`, null attribution/BIB, and the application content URL. Update affected fixtures without inventing photographer or BIB data.

- [ ] **Step 3: Merge only at the authorized Wrapped route boundary**

After direct ownership succeeds and after the route resolves official/legacy/Strava state, load included ready personal rows once and call `mergePersonalRunnerPhotos`. Catch only the optional personal-photo load failure and return the resolved recap unchanged. Do not add personal loads inside `getOfficialWrappedForUser`, `getWrappedForUser`, or Strava fallback loaders.

- [ ] **Step 4: Keep photo failure isolated in the scene**

Use provenance for honest personal/organizer copy, keep `Image unoptimized`, and show a per-photo generic load error without collapsing the scene or any statistics. Do not alter `SharePreview`, `shareModel`, or canvas drawing code.

- [ ] **Step 5: Run focused and full regressions**

Run: `npm test -- tests/runnerPhotoWrapped.test.ts tests/api/wrapped.test.ts tests/officialWrappedService.test.ts tests/recapViewModel.test.ts tests/exportWrapped.test.ts`

Expected: PASS.

Run: `npm test`

Expected: all Vitest suites PASS.

- [ ] **Step 6: Commit the Wrapped slice**

```bash
git add lib/wrappedPayload.ts controllers/enrichmentController.ts lib/officialWrappedService.ts lib/runnerPhotos/wrapped.ts app/api/runners/[runnerId]/wrapped/route.ts app/components/RecapStory.tsx tests
git commit -m "feat: show selected personal photos in Wrapped"
```

### Task 7: Verify privacy, recovery, and rollout readiness

**Files:**
- Create: `tests/integration/runner-photo-flow.test.ts`
- Create: `docs/qa/private-runner-photos.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: completed Tasks 1–6 and a disposable Supabase test project with Storage
- Produces: reproducible acceptance evidence and an operator checklist; no production mutation without explicit authorization

- [ ] **Step 1: Add the disposable integration journey**

Against environment-provided test credentials, create an owner, organizer-only account, and owned runner; upload three generated fixtures; reject a concurrent fourth; reload/complete pending; interrupt each reserve/sign/activate and prepare/write/finalize boundary; run cleanup recovery; toggle one photo out; verify two personal photos precede organizer photos; delete one; verify a newly authorized request to its old content URL is 404; replay its old upload token only to an unserved staging key; release ownership and verify all content requests fail; and confirm anonymous/public Storage reads fail. Skip with an explicit reason when disposable credentials are absent.

Run: `npm run test:db -- tests/integration/runner-photo-flow.test.ts`

Expected: PASS against the disposable project or a clearly reported credential skip locally.

- [ ] **Step 2: Run static, unit, database, and production-build gates**

Run:

```bash
npm test
npm run test:native
npm run lint
npm run build
npx --yes supabase@3.3.0 migration list --local
```

Expected: all available tests PASS, lint has no errors, production build succeeds, and the photo migration appears once in order.

- [ ] **Step 3: Run Supabase security/performance checks**

On the disposable/local project, apply the generated migration, execute `tests/sql/runner-photo-uploads.sql`, inspect bucket configuration, and run the supported database advisors discovered via `npx --yes supabase@3.3.0 db --help`. Fix any RLS, missing-index, unsafe-function, or privilege finding before proceeding.

- [ ] **Step 4: Record mobile and privacy acceptance**

In `docs/qa/private-runner-photos.md`, record 320 × 568 and 390 × 844 manager/empty/populated Wrapped checks, keyboard/focus/error states, three-slot/quota evidence, content response headers, deletion/release revocation, bucket privacy, cleanup recovery, and the fact that the final downloadable card contains no photo.

- [ ] **Step 5: Document rollout order and rollback**

Update README with: migrate/provision first; verify private bucket; set `RUNNER_PHOTO_PROCESS_SECRET`; deploy code; configure periodic worker POST; run disposable acceptance; then enable for users. Rollback disables entry links/uploads first, drains cleanup, retains tables until objects are removed, and never makes the bucket public.

- [ ] **Step 6: Commit the acceptance slice**

```bash
git add tests/integration/runner-photo-flow.test.ts docs/qa/private-runner-photos.md README.md
git commit -m "test: verify private runner photo journey"
```

- [ ] **Step 7: Stop for external-change authorization**

Present the passing evidence and exact remote actions. Only after explicit approval: apply the migration to the intended Supabase project, verify `runner-photos` remains private, configure the secret/schedule, deploy, run the acceptance journey, then push/PR/merge according to the user's requested branch flow.

## Final Verification

Run `git status --short` and confirm only intentional files changed and existing `artifacts/` remains untouched. Review every commit against the spec, then run `npm test`, `npm run test:native`, `npm run lint`, and `npm run build` once more before requesting merge/deployment approval.
