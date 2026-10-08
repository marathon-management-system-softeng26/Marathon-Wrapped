# /docs — Documentation

## Project documentation

- [SRS V3](SRS_v3.md)
- [Diagrams](diagrams/v3/README.md)
- [Documentation conventions](DOCUMENTATION_GUIDELINES.md)
- [Requirement register](requirements-register.md) · [Validation record](SRS_VALIDATION.md)
- [Lecture notes](lecture-notes/2026-10-01-requirements-engineering.md)
- Templates: [weekly log](templates/weekly-working-documentation.md) · [change request](templates/requirements-change-request.md) · [test case](templates/requirement-test-case.md)

## Existing document ownership

| Document | Owner | Issue |
|---|---|---|
| `DATA_REQUIREMENTS.md` — registration fields, eligibility rules, ERD entities & relationships | Bella | 02 / 03 |
| `data-contract.md` — per-runner data shape shared by db → lib → app (restored for issue 05 / #30) | Bella | 02 |
| `wrapped-statistics.md` — how `/lib` turns chip data into Wrapped stats (`buildWrappedStats`, DNF/DNS, tests) | Embun | 05 / #30 |
| `erd.md` + `erd-v5.png` — Entity Relationship Diagram (v5, matches schema; v1–v4 kept) | Bella | 03 |
| `uml/` — use case, activity, sequence, class diagrams | Harry | 07 |
| `microcopy.md` — card text, empty states, Strava/FotoYu messaging | Harry | 17 |
| `SRS.md` + final report | Harry | 22 |
| `demo-script.md` | Bella | 25 |

> `SRS.md` v1.0 (Sep 24, 2026) — source: the team Google Doc. Keep both in sync when requirements change.

> `data-contract.md` was restored on `logic/wrapped-statistics` from `db/schema.sql` and SRS v1.1 so `/lib` and `/app` share field names. Bella remains owner — rename fields only with a team agreement.
