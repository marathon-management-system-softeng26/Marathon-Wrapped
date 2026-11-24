# Private Runner Photo Uploads Design

## Intent

Let an authenticated runner upload at most three personal race photos for an owned registration, choose any subset to appear in the existing Wrapped photo scene, and delete them later. Originals and normalized images remain private. Previously issued application URLs must stop working immediately after photo deletion or ownership release. The final 1080 × 1350 downloadable statistics card remains photo-free.

## Current State

- Wrapped already has a dedicated photo scene and a `Photo` payload consumed by `RecapStory`.
- `officialWrappedService` reads organizer/FotoYu mappings from `fotoyu_photos`; those rows currently contain public URLs.
- The existing public `race-photos` bucket contains demo/organizer assets and is not suitable for personal uploads.
- Application data is served through authorized Next.js routes using the server-only Supabase client. Browser roles do not receive table access.
- Direct runner ownership is `(user_id, runner_id)` in `runner_access`. The existing `requireRunnerAccess` helper also accepts organizers and therefore must not be used for personal-photo authorization.

## Goals

- Add a separate private `runner-photos` bucket.
- Allow only the direct `runner_access` holder to manage and view personal photos.
- Accept JPEG, PNG, and WebP input up to 5 MiB.
- Enforce three live pending, finalizing, or ready uploads per user/runner under concurrency.
- Let the runner include zero, one, two, or three ready photos in Wrapped.
- Put selected personal photos before organizer/FotoYu photos in the existing photo scene.
- Use signed capabilities only for direct upload; all reads recheck ownership through a private/no-store application route.
- Make deletion, ownership release, abandoned uploads, and upload-token replay recoverable.

## Non-goals

- Personal photos do not appear in `SharePreview`, `renderWrapped`, or the downloadable card.
- No public gallery, public Storage URL, social feed, organizer moderation, captions, cropping controls, filters, or recognition.
- No manual reordering in the first version; selected personal photos use upload order.
- Existing organizer/FotoYu mappings and the public `race-photos` bucket remain unchanged.
- The feature is not an archival-original service: accepted input is normalized for safe display.

## Anti-goals

- Do not enforce the three-photo limit only in the client.
- Do not put a username, user ID, runner ID, BIB, or original filename in an object key.
- Do not expose the service-role key, a ready-object key, or a Supabase read URL.
- Do not grant broad `authenticated` access to photo tables or Storage objects.
- Do not treat organizer event access as runner ownership.
- Do not reuse an object key after deletion, failure, cancellation, or replacement.

## Approaches Considered

### 1. Server-authorized direct upload — selected

The application verifies the session and direct ownership, reserves a database slot, and creates a signed upload URL for a random staging key. The browser uploads directly to Storage and calls a finalize endpoint. The server structurally validates and normalizes the staged image into a different ready key. Every image read is proxied through an authenticated no-store route that rechecks current ownership.

This keeps original upload traffic off the application request path, matches the codebase's server-authorized model, provides immediate read revocation, and gives PostgreSQL authority over the slot limit.

### 2. Proxy every upload through Next.js

Rejected because every original image would consume deployment bandwidth and request-body/runtime allowance. The chosen flow proxies only bounded finalization and display, where privacy and validation require server involvement.

### 3. Authenticated browser Storage access through RLS

Rejected because it would add broad browser-facing Storage policies and diverge from the existing server-only application-data boundary. A single opaque staging capability is narrower.

## User Experience

### Entry points

- Add `Manage photos` to each owned race pass.
- Add `Manage my photos` to the Wrapped photo scene, including its empty state.
- Both open `/runners/[runnerId]/photos`.

### Three-slot manager

- Show three persistent slots with thumbnail/state, `Include in Wrapped`, and `Delete` or `Cancel`.
- A new ready photo defaults to included.
- Pending and finalizing slots remain visible after reload with expiry and retry-completion/cancel actions.
- Replacing is delete-then-upload and always receives fresh staging and ready keys.
- Client checks give fast feedback, while server, bucket, database, decoder, and finalizer remain authoritative.
- Status and error text use existing accessible patterns and work at the 320 px minimum layout.

## Storage Model

Provision a private `runner-photos` bucket with a 5 MiB file limit and allowed input MIME types `image/jpeg`, `image/png`, and `image/webp`. Create no public read or general browser object policies. Provision through `supabase/config.toml`/CLI seeding or the documented Storage API/SQL workflow, with a preflight that refuses to silently repurpose a public or more-permissive bucket.

Opaque server-generated paths contain no account or race identity:

- staging: `staging/<random-uuid>/<random-nonce>.upload`
- ready: `ready/<random-uuid>/<random-nonce>.webp`

Signed upload URLs target only staging keys and use Supabase's fixed two-hour validity. Staging and ready keys are never reused. Ready keys are never returned to the browser.

## Database Model

Create `runner_uploaded_photos` with:

- UUID primary key.
- `user_id` and `runner_id`, plus a composite foreign key to `runner_access(user_id, runner_id) on delete cascade`.
- Unique `staging_object_path` and nullable unique `ready_object_path`.
- Declared input MIME/size, constrained to the three accepted types and `1..5242880` bytes.
- Nullable ready MIME/size, constrained to `image/webp` and `1..5242880`.
- State constrained to `pending`, `finalizing`, or `ready`.
- `included boolean not null default true`.
- A conservative reservation cleanup deadline, nullable signed-upload expiry, nullable finalization lease ID/expiry, and creation/ready timestamps.

Index `(user_id, runner_id, state, created_at)` and expired pending rows. Enable RLS, create no browser policies, revoke `anon`/`authenticated`, and grant only required `service_role` privileges.

Create `runner_photo_cleanup` as a durable job/outbox with object path, kind (`staging`/`provisional_ready`/`ready`), `not_before`, claim lease, attempts, and bounded safe error code. A delete trigger on photo metadata enqueues both paths before explicit deletion or ownership cascade removes the row.

Committed ready objects may be cleaned immediately. Staging cleanup retains a tombstone and performs a final delete only after the upload token expires plus an in-flight grace period. Provisional-ready cleanup remains tombstoned until its finalization lease plus an in-flight write grace period; it cannot be acknowledged as complete on an early Storage not-found. These bounds prevent an already-authorized upload or normalization writer from recreating a key after cleanup has been acknowledged.

## Transactional Functions

Functions use invoker rights, `search_path=''`, argument validation, and execute grants only for `service_role`.

### `reserve_runner_photo_upload`

- Verify exact direct ownership in `runner_access`.
- Lock the runner row before counting, using the same lock order in delete/finalize paths.
- Recover stale finalizing rows, expire stale pending metadata, enqueue their persisted paths with the correct safety bounds, and count live pending plus finalizing plus ready rows.
- Refuse the fourth slot.
- Generate a photo ID and opaque staging path, insert a pending row with a conservative cleanup deadline that safely exceeds the later signed-token lifetime, and return the reservation. This deadline exists before the external signing call, so a process crash cannot create an immortal reservation.

### `activate_runner_photo_upload`

- Lock and verify the owned pending reservation after the signed upload URL has been minted.
- Record the actual token expiry derived from mint time without changing the opaque staging key.
- If activation never occurs, the conservative reservation deadline remains authoritative for cleanup; signing failures and cancellation do not remove the tombstone early enough for a still-valid capability to recreate a forgotten object.

### `prepare_runner_photo_ready`

- Lock and verify the owned, activated, unexpired pending reservation.
- Generate and persist the fresh ready path before any normalized object is written, transition to `finalizing`, and record a unique bounded finalization lease ID and expiry.
- Only one request owns a live lease. Retries observe the in-progress slot without starting a second writer. If the lease expires while the signed upload is still valid, queue the provisional path for delayed/tombstoned cleanup and reset the row to activated `pending`, allowing a later retry to allocate a new key. If the upload itself has expired, expire the reservation instead.

### `finalize_runner_photo_upload`

- Lock and verify the owned, unexpired `finalizing` reservation.
- Accept normalized WebP metadata only for the already-persisted provisional ready path and matching live lease ID; a stale writer cannot commit after recovery allocated another key.
- In the same database transaction, transition once to ready, preserve `included=true`, and enqueue the staging-path tombstone. A successful finalize can never strand its original staging object if the process crashes before a later cleanup call.
- Repeated completion returns the ready row without consuming another slot.

### `set_runner_photo_included`

- Update only a ready photo matching the exact user/runner/photo tuple.
- Return a generic not-found result for absent or unauthorized rows.

### `delete_runner_photo`

- Lock runner then photo consistently.
- Delete only the exact owner row; the trigger creates cleanup jobs.
- Return the same result for absent and unauthorized IDs.

### Cleanup claim/ack/fail functions

- Claim bounded due jobs with `FOR UPDATE SKIP LOCKED`, persist a lease, and commit before external Storage calls.
- Acknowledge Storage success/not-found; on failure record a safe code and backoff.
- Allow crashed leases to be reclaimed.

## HTTP and Upload Flow

All routes require verified sessions, same-origin writes, bounded JSON, private/no-store responses, UUID validation, and a direct-owner query rather than organizer-capable `requireRunnerAccess`.

1. `GET /api/runners/[runnerId]/photos` returns ready and live pending/finalizing slots. Ready entries use an application content URL; pending/finalizing entries expose only safe ID/state/expiry or in-progress status for retry or cancel.
2. `POST /api/runners/[runnerId]/photos/uploads` accepts declared MIME/size, reserves a slot, creates a signed staging upload, activates the reservation with the actual token expiry, and returns `{photoId, path, token, expiresAt}`. If signing or activation fails, cancel the reservation but retain its staging cleanup tombstone through the conservative deadline.
3. The browser uses `uploadToSignedUrl(path, token, file, {contentType})`.
4. `POST /api/runners/[runnerId]/photos/[photoId]/complete` checks Storage `info()`, downloads the bounded staging object, and uses a pinned direct `sharp` dependency to perform a real decode with a pixel ceiling, auto-orient, strip EXIF/metadata, constrain dimensions to 4096 × 4096 without enlargement, and produce WebP. Reject empty, oversized, mismatched, malformed, excessive-pixel, or oversized-output files. Before the Storage write, prepare and persist a provisional ready key plus unique finalization lease; exactly that lease's writer uploads normalized bytes to that key and finalizes with the lease ID. A concurrent retry reports in-progress rather than writing. A crash at any boundary leaves either a reclaimable database lease or a discoverable object path for the scheduled sweep.
5. `PATCH /api/runners/[runnerId]/photos/[photoId]` updates `{included}`.
6. `DELETE /api/runners/[runnerId]/photos/[photoId]` or pending cancel deletes metadata and attempts due cleanup; failures remain queued.
7. `GET /api/runners/[runnerId]/photos/[photoId]/content` rechecks session, exact ownership, and ready tuple on every request, downloads via service role, and streams WebP with `Cache-Control: private, no-store`, `Pragma: no-cache`, and `X-Content-Type-Options: nosniff`. Deleted/released/foreign photos return the same generic not-found response immediately.

Original uploads never enter a Next.js request body. Finalization and display intentionally process bounded bytes server-side for validation, metadata removal, and immediate revocation.

## Wrapped Integration

- Load ready, included personal rows once at the outer authorized Wrapped response boundary, after official/legacy/Strava state resolution. Do not add them independently inside nested fallback loaders.
- Adapt personal rows to the existing gallery shape with the authenticated content URL and a `source: 'personal'` discriminator; make BIB/photographer fields nullable or provide a separate internal union rather than inventing attribution.
- Personal photos appear first in upload order, followed by organizer/FotoYu photos.
- Deselecting all personal photos removes only personal uploads; organizer photos remain.
- A missing/corrupt personal object adds a generic warning or placeholder and never hides statistics or organizer photos.
- `RacePhoto` stays unoptimized and may refresh photo data once when a same-ID content request fails.
- Share/export code is unchanged and never fetches or draws personal photos.

## Cleanup and Failure Recovery

- Pending expiry is two hours from actual signed-upload mint time.
- Global cleanup runs on a real schedule, not only when a user visits the manager.
- Before draining ordinary outbox jobs, each scheduled run transactionally sweeps expired unactivated pending reservations, expired activated pending uploads, and expired `finalizing` leases—even when no cleanup job was previously created—and enqueues every persisted staging/provisional-ready path. A finalizing row whose upload is still valid returns to activated pending after its old path is tombstoned; an upload-expired row is removed.
- A timing-safe bearer-protected internal endpoint drains bounded leased jobs without holding database locks during Storage calls.
- Storage not-found is success only after the job's safety bound. Staging and provisional-ready jobs remain tombstoned until their post-capability/post-lease bounds; replacement always uses new keys. Committed ready-object cleanup is immediately due.
- Ownership release cascades metadata and queues cleanup. The old application content URL fails immediately because every read checks current ownership; delayed object deletion cannot expose the file.
- "Immediate revocation" means a content request authorized after the delete or ownership-release transaction commits fails. Bytes already authorized and in flight before that commit cannot be recalled from the network connection.
- Upload success followed by finalize failure can be retried until expiry. Reload shows the pending slot; cancel never remints its path.

## Security and Privacy

- `user_id` always comes from the verified session.
- Only direct runner ownership grants upload, management, or content access.
- Browser receives a single staging upload capability, never a read capability or ready key.
- Structural decode and bounded normalization defend against forged metadata and strip location-bearing EXIF.
- SVG, GIF, HEIC, video, and arbitrary binary files are rejected.
- Upload tokens are bearer capabilities until expiry and are never logged. Replay can only recreate an unserved staging key held under a cleanup tombstone.
- Photo tables use RLS as defense in depth and have no browser policies.

## Verification

- SQL/native: direct owner, organizer denial, concurrent fourth-upload race including finalizing slots, conservative pre-sign expiry, activation, expiry, one-writer finalization leases, stale-writer fencing, finalizing-to-pending recovery, idempotent finalize, selection, generic cross-owner refusal, ownership cascade, cleanup tombstones/safety bounds, job leases/backoff, indexes, RLS, and grants.
- API: authentication/origin/UUID/JSON refusal, MIME/size limits, crashes/failures between reserve-sign-activate and prepare-write-finalize, real decode/pixel/output limits, metadata stripping, pending reload/retry/cancel, toggle/delete, immediate old-content-URL revocation, and generic errors.
- Components: three persistent slots, pending actions, inclusion toggles, mobile layout, progress/retry feedback, and both entry points.
- Wrapped: selected personal photos ordered before FotoYu; deselected absent; merged exactly once across official/legacy/Strava paths; cross-owner content denied; photo failure isolated; export receives no photo dependency.
- Integration: upload three fixtures, reject a concurrent fourth, reload/complete pending, kill the process at every external-call boundary and verify scheduled recovery, toggle one out, show two personal plus organizer photos, delete one, verify a newly authorized request to its old content URL fails immediately, replay an old upload token only to an unserved staging key, drain after expiry, and confirm the bucket is private.

## Rollout

1. Add bucket configuration and database migration/functions.
2. Run database/security advisors and native SQL tests.
3. Add storage service, cleanup worker, and API/content routes.
4. Add the manager and entry links.
5. Merge authorized personal photos once into Wrapped.
6. Apply migration and provision/verify the private bucket.
7. Run disposable integration acceptance and confirm cleanup.

Photo operations must fail closed if the bucket is absent, public, or overly permissive. Wrapped statistics and existing organizer photos remain available when personal-photo infrastructure is unavailable.
