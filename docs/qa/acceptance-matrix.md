# SRS V3 implementation and evidence map

October 20, 2026. This distinguishes implementation from executed acceptance. It does not change the mandatory baseline. The user requested a disconnected Strava state while no API app exists; real provider lifecycle acceptance remains deferred.

| Clauses | Implementation / evidence | Remaining measure |
| --- | --- | --- |
| SR-F1–F7, F6a/b | Retrieval, validation, stats/insights, derived database ranks; unit/native/SQL/live suites | Core contracts verified; see core-foundation.md |
| SR-F8, F9, F11; NF12; SR-D2 | No OAuth application; no simulated connection | Deferred by user no-app decision |
| SR-F10, NF11b | Unique runner_id in strava_metrics; SQL integrity assertions | Seeded samples only |
| SR-F12, NF3, NF6–NF7 | Enrichment deadline/fallback, missing-Strava fixture/live test, disconnected card | Real denial/provider tests deferred |
| SR-F13–F14 | Exact-BIB filter, all returned photos rendered; three sample mappings in owned Storage | Matching/load verified; multi-photo browser fixture test pending |
| SR-F15a/b, NF4 | No-photo card and empty array; no-photo fixture/live test | API verified; browser empty-photo journey pending |
| SR-F16–F17 | Guarded runner payload, explicit identity/event maps; alternating runner API/browser checks | Core isolation verified; sample enrichment labeled |
| SR-F18 | Shared canvas preview/export; actual Aina/Budi/DNF downloads inspected | Final distance-label recapture pending |
| SR-F19a/b | Read-only export; null context/blob tests reject with retry text before download | Unit failure paths verified; browser failure injection pending |
| SR-F20 | Guarded event API and results table | Live API eight runners verified; organizer browser evidence pending |
| SR-F21, F24 | Guarded draft, atomic RPC, preserved failed draft, category-change regression | SQL/live create/update/reject verified; browser save/rejection pending |
| SR-F22, NF19 | Three complete sample heroes; DNF, missing Strava/photos, DNS/no-result fixtures | Seed audit verified; Strava values are seeded samples |
| SR-F23 | Unknown/unauthorized 404 with return/retry; missing-result unavailable payload | Unit/live verified; browser state pending |
| SR-NF1 | Production-local usable-page timing | Twenty-load acceptance pending; Windows DNS intermittently failing |
| SR-NF2 | One abortable recap fetch on mount; no remote provider call during read | Source checked; request trace pending |
| SR-NF5a/b | DNF payload/browser/PNG null finish and pace | Verified; category-distance label recapture pending |
| SR-NF8–NF11a | Unique immutable BIB, domain FKs, one chip result; SQL tests | Verified; atomic rollback covered |
| SR-NF13 | Private credentials, whitelist payload, exports omit health metrics | Source/response scans and images checked; future token store deferred |
| SR-NF14 | Organizer entry hidden from runner; API guard before private access | Runner catalog/denied API verified |
| SR-NF15 | 1280×900 desktop / 390×844 mobile story captures | Core layout inspected; final review pending current captures |
| SR-NF16 | Selection → recap one transition; direct photos/save one page choice | Within three for core actions; Connect unavailable by scope decision |
| SR-NF17 | Codex in-app Chromium, desktop/mobile viewports | Viewport testing is not separate mobile-browser certification |
| SR-NF18 | Project created at approved $0/month, eight fixtures and 256KB stock asset | Provisioning verified; account-wide usage review pending |
| UR-D1 | DNF expanded, pace /km, split comparison text, cadence spm labels | Full everyday-language glossary pending |
| UR-D2, SR-D1 | Disconnected card explains baseline is available | Browser inspected; provider-denied lifecycle deferred |
| UR-D3 | Pinned red/cream/lime world, local Bricolage, Impeccable detector/design docs | Final visual disposition pending |

User-level acceptance follows SRS section 7.4. No full UR acceptance is claimed while these gaps remain. Evidence: [core](core-foundation.md), [connected UI](connected-ui.md). Database checks were executed separately from the unit suite.
