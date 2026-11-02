# SRS V4 implementation and evidence map

Updated November 3, 2026. This distinguishes implementation from executed acceptance and preserves the V3 clause links used by the existing evidence. The October 20 disconnected-only decision was superseded by the approved full opt-in Strava direction. After the final review fixes, 328 local automated checks, 11 activated PGlite/PostgreSQL checks, 240 focused controlled-provider checks, 111 export/privacy checks, and the lint/type/build gates passed. The fixes cover durable runner/generation opt-in, unrelated activity-data removal, safe Connect failure returns, and organizer control suppression. The branch-wide whitespace gate is clean. Real-provider, dedicated remote database, webhook/scheduler, and manual browser acceptance remain pending because no corresponding credentials or usable authenticated browser fixture was supplied.

| Clauses | Implementation / evidence | Remaining measure |
| --- | --- | --- |
| SR-F1–F7, F6a/b | Retrieval, validation, stats/insights, derived database ranks; unit/native/SQL/live suites | Core contracts verified; see core-foundation.md |
| FR-08; SR-F8, F9; NF12 | Explicit runner-bound `POST` connect, stored callback context, state/session/scope/athlete checks, encrypted credentials, safe denial/replay handling; automated route tests | Real Strava consent, callback, and reconnect acceptance pending |
| FR-09; SR-F10, NF11b | Configured `Run` matching, ±500 m boundary, auto/confirmation rules, atomic selection, five nullable metrics, safe candidate response, runner-owner privacy; unit/API and PGlite evidence | Dedicated remote concurrency run and real activity import pending |
| FR-10; SR-F11 | Local ingestion disabled before remote cleanup, live selection/metrics removed transactionally, durable revocation retry, explicit disconnecting/reauthorize states; automated API/SQL evidence | Real provider revocation and refresh-persistence acceptance pending |
| FR-11; SR-F12, NF3, NF6–NF7 | Denial/error/partial/no-match/ambiguity states, independent chip/photo fallback, callback feedback cleanup, demo/live provenance separation, export excludes health metrics; automated service/UI/export evidence | Manual provider-denial, responsive/focus, and end-to-end browser acceptance pending |
| SR-F13–F14 | Exact-BIB filter, all returned photos rendered; three sample mappings in owned Storage | Two-photo browser fixture rendered both loaded images; cleaned up afterward |
| SR-F15a/b, NF4 | No-photo card and empty array; no-photo fixture/live test | API and browser empty-photo card verified |
| SR-F16–F17 | Guarded runner payload, explicit identity/event maps; alternating runner API/browser checks | Core isolation verified; sample enrichment labeled |
| SR-F18 | Shared canvas preview/export; actual Aina/Budi/DNF downloads inspected | All three exports have explicit distance/category-distance labels |
| SR-F19a/b | Read-only export; null context/blob tests reject with retry text before download | Unit failure paths verified; browser failure injection pending |
| SR-F20 | Guarded event API and results table | Live API and browser table verified; eight-runner dataset restored |
| SR-F21, F24 | Guarded draft, atomic RPC including optional metrics/photos, preserved failed draft | SQL/live/browser create, update, rejection and correction verified |
| SR-F22, NF19 | Three complete sample heroes; DNF, missing Strava/photos, DNS/no-result fixtures | Seed audit verified; Strava values are seeded samples |
| SR-F23 | Unknown/unauthorized 404 with return/retry; missing-result unavailable payload | Unit/live verified; browser state pending |
| SR-NF1 | Twenty consecutive production-local usable-page reloads | 20/20 within 3 seconds, range 1.785–2.324 seconds; local warm-cache environment |
| SR-NF2 | One abortable recap fetch on mount; no remote provider call during read | Trace verified exactly 20 requests for 20 reloads |
| SR-NF5a/b | DNF payload/browser/PNG null finish and pace | Verified, including explicit category-distance export label |
| SR-NF8–NF11a | Unique immutable BIB, domain FKs, one chip result; SQL tests | Verified; atomic rollback covered |
| SR-NF13 | Encrypted token lifecycle, private/no-store API responses, allowlisted candidate payload, owner-only live metrics, exports omit health metrics | Automated privacy evidence; inspect a real browser/network/log/export run before acceptance |
| SR-NF14 | Organizer entry hidden from runner; API guard before private access | Runner catalog/denied API verified |
| SR-NF15 | Desktop/mobile story captures with 1280×900 / 390×844 viewport overrides | Native captures inspected; independent material fixes confirmed, ship disposition |
| SR-NF16 | Selection → recap one transition; direct photos/save and explicit Strava controls on the recap | Automated render/navigation evidence; manual action-count check pending |
| SR-NF17 | Codex in-app Chromium, desktop/mobile viewports | Viewport testing is not separate mobile-browser certification |
| SR-NF18 | Approved $0/month, measured 12.1MB database and 256KB stock asset; expected demo usage budget | Project footprint fits documented free allowances; account-wide usage review pending |
| UR-D1 | DNF expanded, pace /km, split comparison text, cadence spm labels | Full everyday-language glossary pending |
| UR-D2, SR-D1 | Accessible card models disconnected, authorizing, importing, confirmation, no-match, connected/partial, unavailable, disconnecting, and reauthorization states with safe feedback | Static/render tests passed; provider-denied and responsive/focus browser acceptance pending |
| UR-D3 | Pinned red/cream/lime world, local Bricolage, Impeccable detector/design docs | Full review and bounded fix confirmation: ship |

User-level acceptance follows SRS section 7.4. No full FR-08–FR-11 or UR acceptance is claimed while the external and manual gates remain. Evidence: [core](core-foundation.md), [connected UI](connected-ui.md), and the [Strava integration runbook](strava-integration.md). Database checks are executed separately from the unit suite.
