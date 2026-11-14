# Requirement register

## Active contract as of November 11, 2026

The November 11 decision supersedes chip-first Wrapped generation and November 2 opt-in enrichment. Use [SRS V4](SRS_v4.md) and the [approved design](superpowers/specs/2026-11-11-strava-first-runner-claims-design.md) for requirement text and the [acceptance matrix](qa/acceptance-matrix.md) for verification.

| V4 requirements | Current coverage |
| --- | --- |
| FR-01–FR-03 | Confirmed signup, event-scoped one-time claims, one direct owner per registration, and multiple claims per account |
| FR-04–FR-08 | Strava action per runner, explicit OAuth, one athlete connection per account, separate registration attachments, bounded selection, stored projection, and ready-only showcase |
| FR-09–FR-11 | Registration detach, account-wide disconnect, durable revocation, and retry/reconnect states |
| FR-12–FR-15 | Optional BIB-matched photos and export from a ready snapshot |
| FR-16–FR-19 | Event-scoped organizer access, legacy results, registration maintenance, and Strava race configuration |
| NFR-01–NFR-09 | Usability, privacy, isolation, and deployment limits |

## Historical V3 references

**Baseline:** [SRS V3](SRS_v3.md), October 1, 2026. Stable requirement IDs are grouped by module without renaming established references. Lettered clauses retain their V2 parent as a traceability group. No retired ID may be reassigned.

The historical table preserves V3 requirements and their function coverage. Requirement text, rationale and verification measures are in the SRS; user-to-system mapping is in section 7.4. Issue and executed-test references remain to be populated by the team; no implementation or acceptance is implied.

Implementation evidence through November 2, 2026 is recorded separately in the [acceptance matrix](qa/acceptance-matrix.md), with verified, deferred and unverified measures distinguished. The location rows below retain the original baseline and link the new Strava evidence where available; automated implementation does not imply live-provider acceptance.

| Clause ID | Parent / existing reference | Module | Priority | Function coverage | Issue / actual test evidence |
| --- | --- | --- | --- | --- | --- |
| **UR-F1** | Same ID | Results | Mandatory (shall) | FS-01 / FS-02 | Not yet recorded |
| **UR-F2** | Same ID | Results | Mandatory (shall) | FS-01 / FS-02 | Not yet recorded |
| **UR-F3** | Same ID | Strava | Mandatory (shall) | FS-03 / FS-04 | Automated OAuth/connect evidence; live provider pending |
| **UR-F4** | Same ID | Strava | Mandatory (shall) | FS-03 / FS-04 | Automated metrics/disconnect/fallback evidence; live provider pending |
| **UR-F5** | Same ID | Photos | Mandatory (shall) | FS-05 | Not yet recorded |
| **UR-F6** | Same ID | Recap / export | Mandatory (shall) | FS-01 / FS-06 | Not yet recorded |
| **UR-F7** | Same ID | Results | Mandatory (shall) | FS-01 / FS-02 | Not yet recorded |
| **UR-F8** | Same ID | Organizer | Mandatory (shall) | FS-07 / FS-08 | Not yet recorded |
| **UR-F9** | Same ID | Organizer | Mandatory (shall) | FS-07 / FS-08 | Not yet recorded |
| **UR-NF1** | Same ID | Shared quality | Mandatory (shall) | Across functions | Not yet recorded |
| **UR-NF2** | Same ID | Shared quality | Mandatory (shall) | Across functions | Not yet recorded |
| **UR-NF3** | Same ID | Shared quality | Mandatory (shall) | Across functions | Not yet recorded |
| **UR-NF4** | Same ID | Shared quality | Mandatory (shall) | Across functions | Not yet recorded |
| **UR-NF5** | Same ID | Shared quality | Mandatory (shall) | Across functions | Not yet recorded |
| **UR-D1** | Same ID | Recap / export | Desirable (should) | FS-01 / FS-06 | Not yet recorded |
| **UR-D2** | Same ID | Strava | Desirable (should) | FS-03 / FS-04 | Automated optional-state and safe-feedback evidence; browser acceptance pending |
| **UR-D3** | Same ID | Shared quality | Desirable (should) | Across functions | Not yet recorded |
| **SR-F1** | Same ID | Results | Mandatory (shall) | FS-01 / FS-02 | Not yet recorded |
| **SR-F2** | Same ID | Results | Mandatory (shall) | FS-01 / FS-02 | Not yet recorded |
| **SR-F3** | Same ID | Results | Mandatory (shall) | FS-01 / FS-02 | Not yet recorded |
| **SR-F4** | Same ID | Results | Mandatory (shall) | FS-01 / FS-02 | Not yet recorded |
| **SR-F5** | Same ID | Results | Mandatory (shall) | FS-01 / FS-02 | Not yet recorded |
| **SR-F6a** | SR-F6 | Results | Mandatory (shall) | FS-01 / FS-02 | Not yet recorded |
| **SR-F6b** | SR-F6 | Results | Mandatory (shall) | FS-01 / FS-02 | Not yet recorded |
| **SR-F7** | Same ID | Results | Mandatory (shall) | FS-01 / FS-02 | Not yet recorded |
| **SR-F8** | Same ID | Strava | Mandatory (shall) | FS-03 / FS-04 | Runner-bound explicit-connect route tests; real consent pending |
| **SR-F9** | Same ID | Strava | Mandatory (shall) | FS-03 / FS-04 | Encrypted lifecycle and runner ownership tests; live provider pending |
| **SR-F10** | Same ID | Strava | Mandatory (shall) | FS-03 / FS-04 | Matching, confirmation, nullable five-metric, privacy, and PGlite evidence |
| **SR-F11** | Same ID | Strava | Mandatory (shall) | FS-03 / FS-04 | Disconnect/local cleanup and durable-retry tests; live revocation pending |
| **SR-F12** | Same ID | Strava | Mandatory (shall) | FS-03 / FS-04 | Denial/error/partial-data fallback tests; manual provider acceptance pending |
| **SR-F13** | Same ID | Photos | Mandatory (shall) | FS-05 | Not yet recorded |
| **SR-F14** | Same ID | Photos | Mandatory (shall) | FS-05 | Not yet recorded |
| **SR-F15a** | SR-F15 | Photos | Mandatory (shall) | FS-05 | Not yet recorded |
| **SR-F15b** | SR-F15 | Photos | Mandatory (shall) | FS-05 | Not yet recorded |
| **SR-F16** | Same ID | Recap / export | Mandatory (shall) | FS-01 / FS-06 | Not yet recorded |
| **SR-F17** | Same ID | Recap / export | Mandatory (shall) | FS-01 / FS-06 | Not yet recorded |
| **SR-F18** | Same ID | Recap / export | Mandatory (shall) | FS-01 / FS-06 | Not yet recorded |
| **SR-F19a** | SR-F19 | Recap / export | Mandatory (shall) | FS-01 / FS-06 | Not yet recorded |
| **SR-F19b** | SR-F19 | Recap / export | Mandatory (shall) | FS-01 / FS-06 | Not yet recorded |
| **SR-F20** | Same ID | Organizer | Mandatory (shall) | FS-07 / FS-08 | Not yet recorded |
| **SR-F21** | Same ID | Organizer | Mandatory (shall) | FS-07 / FS-08 | Not yet recorded |
| **SR-F22** | Same ID | Organizer | Mandatory (shall) | FS-07 / FS-08 | Not yet recorded |
| **SR-F23** | Same ID | Results | Mandatory (shall) | FS-01 / FS-02 | Not yet recorded |
| **SR-F24** | Same ID | Organizer | Mandatory (shall) | FS-07 / FS-08 | Not yet recorded |
| **SR-NF1** | Same ID | Shared quality | Mandatory (shall) | Across functions | Not yet recorded |
| **SR-NF2** | Same ID | Shared quality | Mandatory (shall) | Across functions | Not yet recorded |
| **SR-NF3** | Same ID | Shared quality | Mandatory (shall) | Across functions | Not yet recorded |
| **SR-NF4** | Same ID | Shared quality | Mandatory (shall) | Across functions | Not yet recorded |
| **SR-NF5a** | SR-NF5 | Shared quality | Mandatory (shall) | Across functions | Not yet recorded |
| **SR-NF5b** | SR-NF5 | Shared quality | Mandatory (shall) | Across functions | Not yet recorded |
| **SR-NF6** | Same ID | Shared quality | Mandatory (shall) | Across functions | Not yet recorded |
| **SR-NF7** | Same ID | Shared quality | Mandatory (shall) | Across functions | Not yet recorded |
| **SR-NF8** | Same ID | Shared quality | Mandatory (shall) | Across functions | Not yet recorded |
| **SR-NF9** | Same ID | Shared quality | Mandatory (shall) | Across functions | Not yet recorded |
| **SR-NF10** | Same ID | Shared quality | Mandatory (shall) | Across functions | Not yet recorded |
| **SR-NF11a** | SR-NF11 | Shared quality | Mandatory (shall) | Across functions | Not yet recorded |
| **SR-NF11b** | SR-NF11 | Shared quality | Mandatory (shall) | Across functions | Not yet recorded |
| **SR-NF12** | Same ID | Shared quality | Mandatory (shall) | Across functions | Not yet recorded |
| **SR-NF13** | Same ID | Shared quality | Mandatory (shall) | Across functions | Not yet recorded |
| **SR-NF14** | Same ID | Shared quality | Mandatory (shall) | Across functions | Not yet recorded |
| **SR-NF15** | Same ID | Shared quality | Mandatory (shall) | Across functions | Not yet recorded |
| **SR-NF16** | Same ID | Shared quality | Mandatory (shall) | Across functions | Not yet recorded |
| **SR-NF17** | Same ID | Shared quality | Mandatory (shall) | Across functions | Not yet recorded |
| **SR-NF18** | Same ID | Shared quality | Mandatory (shall) | Across functions | Not yet recorded |
| **SR-NF19** | Same ID | Shared quality | Mandatory (shall) | Across functions | Not yet recorded |
| **SR-D1** | Same ID | Strava | Desirable (should) | FS-03 / FS-04 | Automated accessible card-state and callback-feedback evidence; browser acceptance pending |
| **SR-D2** | Same ID | Strava | Desirable (should) | FS-03 / FS-04 | Automated optional-connect and disconnect-state copy evidence |

## Change history

| Revision | Affected IDs | Reason / impact |
| --- | --- | --- |
| V2 → V3 | All existing UR/SR IDs | Add rationale, verification, module grouping and function/diagram references; no mandatory feature downgraded. |
| V3 split | SR-F6a/b, SR-F15a/b, SR-F19a/b, SR-NF5a/b, SR-NF11a/b | Separate independent obligations; parent references remain valid groups. |
| V3 new clarification | SR-F23, SR-F24 | Explicit result-unavailable and rejected-save paths in the new flowcharts. |
| V3 desirable presentation | UR-D1–UR-D3, SR-D1–SR-D2 | Everyday explanations, optional-connect messaging, confirmed palette and disconnect feedback. |
| November 2, 2026 Strava direction (superseded) | UR-F3–UR-F4, SR-F8–SR-F12, SR-NF12, SR-D1–SR-D2 | Replace the October 20 disconnected-only delivery decision with the approved full opt-in implementation. Automated and local PostgreSQL evidence is recorded; real-provider, dedicated remote database, and manual browser acceptance remain pending. |
| November 11, 2026 Strava-first direction | SRS V4 FR-01–FR-19, NFR-01–NFR-09 | Require confirmed signup, one-time registration claim, per-race athlete attachment, and a stored ready projection for Wrapped. Legacy organizer timing remains available. |

Record future changes with the [change-request form](templates/requirements-change-request.md); update affected diagrams, function forms and tests together. Team review of the V3 additions is pending.
