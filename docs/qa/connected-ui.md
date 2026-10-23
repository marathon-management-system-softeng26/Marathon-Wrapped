# Connected UI evidence — October 20, 2026

Environment: Windows, Node 24.16.0, Next production server at http://127.0.0.1:3007; dedicated Singapore Supabase marathon-wrapped (`anbnuegocddoowagqmxw`). The Figma Make export remained a read-only reference outside this worktree.

## Automated checks

- Unit suite: 88 passed; 15 integration checks intentionally skipped by this command.
- Native input boundary: 10 passed.
- Live integration: 15 passed against the production application and dedicated cloud database. Includes login cookies, runner isolation, organizer scope, private drafts, atomic timing/splits and optional metrics/photo replacement, rejection rollback and clearing.
- One live run overlapped two disposable browser fixtures and failed its two exact eight-runner assertions (13 passed). After exact-ID/BIB cleanup, the full suite passed all 15. These were fixture-count failures, not ignored passing results.
- Transactional SQL checks cover initial data, ranks/integrity, lifecycle, organizer management and complete optional aggregates. Optional-aggregate SQL verified late failure restores identity, metrics and photos; absent enrichment preserves records and explicit empty enrichment clears them. Tests roll back.
- Auth network failures return service failure instead of incorrect-credentials/session errors. Moving organizer drafts from 10K to 5K removes hidden out-of-distance splits. Both regressions have RED/GREEN evidence.
- Final production build, TypeScript, lint and 88-unit suite passed after visual corrections. Native 10 and live 15 passed earlier in this verification pass; the subsequent changes affect only feedback styling, intro copy, autofill and photo-count grammar.

## Browser journeys

Codex in-app Chromium with desktop 1280 × 900 and mobile 390 × 844 viewport overrides; native screenshots may exclude scrollbar/content margins. Local evidence is ignored under `.impeccable/review/`. Authoritative corrected captures are `verified/*.jpg`; malformed clipped captures are superseded. No screenshot was resized or cosmetically edited.

- Password sign-in, runner/organizer catalog, protected recap and organizer navigation exercised with synthetic accounts. Sign-out returns to login; browser Back does not restore authenticated content.
- Aina: 5K, 25:23, 5:05/km, fastest km 5 at 4:50. Distance, split, Strava, photo and share cards inspected. Overall rank explicitly names its distance scope. Strava is disconnected and seeded metrics are labeled.
- Gallery opens the actual stock image in a native dialog, closes and returns focus. A disposable complete hero with two photo mappings displayed both loaded 861px stock images. The no-photo runner showed its empty card while retaining statistics.
- Actual Aina, Budi and DNF PNG downloads were opened and inspected: 1080 × 1350, distinct selected identities and correct timing/status. Preview and download share one renderer; exports omit health metrics. DNF labels category distance and contains no finish/pace claim.
- Organizer browser create and edit persisted identity, timing/splits, sample metrics and two photo mappings. A duplicate BIB was rejected with its draft intact; correcting the BIB saved successfully and refreshed the table. Exact disposable fixture IDs were removed afterward, restoring eight runners and original ranks.
- Browser export-failure injection and separate mobile/desktop browser products are not certified. Canvas/blob failures have unit coverage. Viewport testing does not establish a real mobile browser/device baseline.

## Usable-page performance

Twenty consecutive authenticated Aina reloads on the production application, eight-runner dataset, warm browser cache and normal network. Driver stopwatch measured reload start through visible selected-runner identity and ready recap navigation; it includes automation overhead. All 20 were within 3 seconds (requirement: at least 19).

Milliseconds, in order: 2324, 1929, 1854, 1785, 1803, 2248, 1978, 1835, 1905, 1832, 2204, 2052, 2077, 1866, 1857, 2276, 1863, 1838, 1832, 1936. Range 1.785–2.324 seconds. These are local measurements, not a deployed latency guarantee.

A QA-only HTTP listener recorded exactly 20 Wrapped requests during these 20 reloads: one per reload, no duplicates. It logged only paths and timestamps and is excluded from shipping source. Raw timing JSON and trace are in the ignored review directory. Earlier local DNS failures recovered; no system DNS settings changed. The final normal production server runs without the listener.

## Design review

Impeccable detector ran once; its Arial body-stack warning was retained for readable Operate forms/data. Experience headings use locally hosted Bricolage. Independent source review found no critical/important issues in the final core and complete organizer aggregate. Product/design documents and token sidecar were checked against source.

The independent visual evidence gate initially required recapture. Native corrected screenshots cleared it. Full review found three material fixes: distinguish rejected organizer saves with error styling and an alert role, remove the duplicate intro event eyebrow, and theme browser autofill. All three were applied and confirmed in a bounded review with disposition **ship**. The final mobile rejection capture also confirms its pink error surface, alert role and preserved draft. Static review does not certify every interaction or a separate mobile browser product.

## Free-tier footprint and acceptance limits

The project was created at the approved $0/month quote. Database measurement: 12,105,395 bytes; eight runners; one Storage object of 255,791 bytes. A rehearsal of 100 uncached image loads transfers about 25.6 MB before API/Auth traffic; three synthetic users exercise Auth. Supabase documents 500 MB database per Free project, 1 GB Storage, 5 GB egress and 50,000 monthly active users ([pricing](https://supabase.com/pricing), [billing](https://supabase.com/docs/guides/platform/billing-on-supabase), checked October 20). This project's measured footprint and expected demo usage fit those allowances. Organization-wide monthly usage, including the unrelated project, was not available in these checks; review Dashboard usage before the public demonstration. No paid upgrade or deployment was performed.

Real Strava OAuth remains deferred by the user's explicit no-app/disconnected-state decision. Cross-browser/device certification and account-wide usage remain final-demo acceptance limits. [SRS traceability](acceptance-matrix.md) distinguishes these from implemented behavior; no full original-SRS acceptance is claimed.
