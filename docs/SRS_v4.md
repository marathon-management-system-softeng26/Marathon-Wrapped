# Software Requirements Specification V4
## Marathon Wrapped

**Version:** 4.0  
**Date:** November 11, 2026\
**Status:** Strava-first runner workflow approved November 11, 2026\
**Course:** Software Engineering — Sampoerna University × University of Arizona  
**Demo event:** Soekarno Run 2027  
**Baseline:** [SRS V3](SRS_v3.md)

## 1. Purpose and scope

Marathon Wrapped gives Soekarno Run 2027 participants in the 5K and 10K categories a private showcase they can save as an image. Organizers maintain registrations and demo results within their mapped event. Runner identity, event, category, and BIB come from the registration. The selected Strava activity supplies performance data, and the simulated FotoYu gallery supplies optional BIB-matched photos. Label synthetic demonstration data as such.

**Shall** means required. **Should** means recommended. OAuth requires the runner's consent. A runner can use the dashboard after claiming a registration, while a qualifying activity and a stored projection are required to open the showcase.

### Decision history

The November 11, 2026 decision supersedes chip-first Wrapped generation and the November 2 opt-in enrichment direction, which had replaced the October 20 disconnected-only decision. The legacy organizer result editor and chip records remain available for event operations. The [November 11 design](superpowers/specs/2026-11-11-strava-first-runner-claims-design.md) defines the approved workflow. The [acceptance matrix](qa/acceptance-matrix.md) tracks evidence against it.

## 2. Stakeholders

| Stakeholder | What they need | Relationship to the system |
| --- | --- | --- |
| Runner | An accurate, understandable personal recap, their matched photos, control over Strava connection, and an image they can save or share. | Primary user. |
| Event organizer | A view of event results and a way to maintain reliable demonstration data. | Primary user with organizer functions. |
| Project team | A clear, achievable scope and requirements that can guide development, documentation, and testing. | Builds and verifies the prototype. |
| Course instructors and graders | A working demonstration and evidence that the project meets its stated requirements. | Reviews and evaluates the deliverables. |

Strava is an external service dependency. FotoYu represents a simulated photo source in this prototype; it is not a live integration.

## 3. Functional requirements

Each row states the expected behavior and a practical way to check it. The superseded chip-first showcase used chip finish times, split insights, ranks, percentiles, and overtakes. The active showcase uses only the selected activity for performance claims, with no cohort comparisons.

### Account and registration

| ID | Requirement | Acceptance check |
| --- | --- | --- |
| FR-01 | A runner shall sign up with Supabase Auth, confirm their email, and sign in before claiming a registration. The system shall authorize runner access through server-owned `runner_access` mappings. A public BIB, matching email address, and editable user metadata confer no access. | Try signup without confirmation and attempt access using an unclaimed account, BIB, or metadata. Confirm that a mapped owner can open the registration. |
| FR-02 | A verified organizer shall issue or revoke a claim code only for a registration in their mapped event. The system shall return the raw code once, store only its SHA-256 hash, and expire it after seven days. | Check that the code is visible once. Test same-event issuance and revocation, cross-event denial, and expiry. |
| FR-03 | The system shall atomically consume a claim and create the runner mapping. Each registration shall have at most one direct owner, and an account may claim multiple registrations. A retry by the same account shall be idempotent. | Race two accounts to redeem a code, retry as the winner, and claim a second registration. Verify non-enumerating failure messages for invalid, expired, revoked, used, and cross-event claims. |

### Strava setup and showcase

| ID | Requirement | Acceptance check |
| --- | --- | --- |
| FR-04 | Every claimed registration shall have a dashboard action reflecting its Strava or showcase state, including **Connect Strava**, **Use Strava for this race**, and **View Wrapped** as applicable. | Open a dashboard with multiple registrations and verify the action and state on each card. |
| FR-05 | The system shall use the attached registration's event and category to bound imports by race window and distance tolerance. The worker shall admit only that athlete's qualifying `Run` activities. It may auto-select a sole fully qualifying match when the configured location check passes. Ambiguity or missing location evidence requires explicit confirmation. | Test a sole match, missing location, several matches, no match, and overlapping windows. Verify an activity can serve at most one registration within a connection generation. |
| FR-06 | The worker shall validate the selected activity and persist a versioned, presentation-safe snapshot keyed by runner, user, connection generation, and selected activity. A snapshot may include distance, moving and elapsed time, average and maximum speed, metric kilometer splits, average and maximum heart rate, elevation gain, calories, and average cadence when available. The system shall derive average pace from moving time and activity distance, and fastest and slowest splits from its metric splits and omit missing values. | Check the stored projection against the selected activity, with missing and malformed values and conflicting legacy chip data. Inspect the output for fabricated metrics and cohort comparisons. |
| FR-07 | Dashboard and Wrapped reads shall use stored state. Only a `ready` snapshot shall render a showcase. Unknown or unauthorized registrations shall receive a safe unavailable response. | Verify setup, authorizing, importing, confirmation, no match, building, failure, reauthorization, and ready states. Confirm zero provider requests during ordinary reads. |
| FR-08 | A runner shall grant Strava OAuth consent explicitly. The application shall explain `activity:read_all` before consent, validate callback state and granted scope, verify athlete identity, and encrypt and rotate credentials. One application account shall have one active athlete connection and may create separate opt-in attachments for its claimed registrations. | Exercise denial, insufficient scope, invalid state, and athlete mismatch. Authorize once and attach two registrations, then verify each registration's independent import, selection, and snapshot. |
| FR-09 | A runner shall be able to detach one registration. The system shall remove its attachment, candidates, selection, and snapshot while retaining the athlete connection and any other registrations' attachments. | Detach one ready registration while a second registration has a showcase. Verify setup for the first and continued access for the second. |
| FR-10 | A runner shall be able to disconnect the Strava account. The system shall immediately disable ingestion and remove all live attachments, candidates, selections, and snapshots for the account. It shall retry remote credential revocation durably when needed. | Disconnect with two ready showcases, reload both, and simulate remote failure. Verify pending revocation and the supported recovery path. |
| FR-11 | The system shall provide a recovery action for denied or incomplete consent, no match, rate limits, projection failure, and expired or invalid credentials. A failed build shall preserve the selected activity for retry. | Exercise each condition and verify the expected setup, import, retry, or reconnect action. Confirm that none of these states presents a showcase. |

### Race photos and image export

| ID | Requirement | Acceptance check |
| --- | --- | --- |
| FR-12 | The system shall match sample race photos by the runner's unique BIB and display all available matching photo records. | Open a runner with multiple photos and confirm all returned matches belong to that BIB. |
| FR-13 | When no photos match, the system shall show a no-photo state and keep the remaining recap usable. | Open a runner with zero photo records. Verify the message and ready showcase. |
| FR-14 | A runner shall be able to export their rendered recap as an image that they can save and share. | Export two ready showcases as 1080 × 1350 PNGs and verify runner identity and rendered content. Include a registration with zero photos and confirm the image excludes health metrics and private activity and athlete identifiers. |
| FR-15 | If export fails, the system shall show an actionable error while preserving the showcase and stored snapshot. | Force an export failure and verify a correction or retry action and unchanged snapshot data. |

Sharing means the runner can use the exported image with their chosen service. Automatic social posting is outside scope.

### Organizer functions

| ID | Requirement | Acceptance check |
| --- | --- | --- |
| FR-16 | An organizer shall be able to view results for all seeded runners in the prototype event, including DNF runners. | Compare the organizer view with the complete Soekarno Run 2027 dataset. |
| FR-17 | An organizer shall be able to create and update hero-runner demonstration data through the supported management interface without changing source code. | Create and update a demonstration runner and linked records, reload, and verify persistence. Replacement behavior remains OD-07. |
| FR-18 | When a save is rejected, the organizer interface shall explain the reason and allow correction. It shall report success only after a successful save. | Attempt a duplicate BIB, an invalid relationship, and a failed save. Verify rejection feedback and a correction path. |
| FR-19 | A verified organizer shall manage race windows, sport types, distance tolerances, and optional start-location constraints for categories in their mapped event. Organizer access shall confer no access to private athlete data. | Save a valid configuration, then try an invalid save, a cross-event update, and an athlete-data read as an organizer without direct runner access. |

## 4. Quality requirements

| ID | Requirement | Acceptance check |
| --- | --- | --- |
| NFR-01 | A seeded recap shall become usable within 3 seconds in at least 19 of 20 consecutive page loads under the agreed test conditions. | Record the dataset, connection, environment, usable-state definition, and all 20 measurements. Conditions remain OD-08. |
| NFR-02 | A single recap load shall avoid redundant identical runner-data requests unless there is a documented reason. | Inspect a request trace for unnecessary repeated requests. |
| NFR-03 | Missing activity data and build failures shall leave the runner a usable setup or retry state. Missing photos shall leave a ready showcase usable. | Exercise no match, build failure, and a ready registration without photos. |
| NFR-04 | The recap and core actions shall be readable and usable at the mobile and desktop sizes and in the browsers selected by QA. | Record browser versions and viewport sizes; test viewing, connecting, photos, and export in each supported environment. |
| NFR-05 | The runner shall reach the recap, Strava connection, photo gallery, and export action within three navigation steps from their relevant starting screens. | Agree starting screens under OD-08 and count transitions to each action. |
| NFR-06 | Runner payloads, exports, and logs shall exclude credentials, raw activity payloads, routes, coordinates, and private athlete profile data. Candidate identifiers shall be private to the owner selecting an activity. | Inspect runner and organizer responses, logs, and exported images for private fields. |
| NFR-07 | Organizer-only functions shall not be offered as runner actions. | Review runner screens. Verify the server also denies unauthorized organizer requests. |
| NFR-08 | Required services shall operate within their applicable free-tier limits during the demonstration. | Record applicable allowances and expected demonstration usage. |
| NFR-09 | The demonstration shall use clearly labeled synthetic fixtures and exercise the ready, no-match, and no-photo states. | Audit fixture labels and open each state. |

### Recommended presentation

Explain pace, splits, and cadence in everyday language. Tell the runner why Strava consent is needed for a showcase. Provide brief feedback when consent fails or a connection is removed.

The interface should use the approved project palette: red `#BA3143`, cream `#FAF6EB`, lime `#D8F24B`, and dark text `#291B1D`, with readable contrast.

## 5. Data and business rules

| Information | Source | Rule |
| --- | --- | --- |
| Event, category, BIB, runner identity | Trusted registration | BIB is unique and non-transferable. A verified claim creates direct access. |
| Activity and snapshot | Connected athlete's selected Strava activity | Store a privacy-minimized projection scoped to its runner and connection generation. Optional activity fields may be absent. |
| Photos | Simulated FotoYu-style records | Zero or more matches by BIB. |
| Chip results and splits | Seeded organizer data | Retained for legacy event operations. |

### Registration source records

Registration is a source of prototype data, not a new registration workflow. V3's source fields remain: full legal name, date of birth, gender (M/F in the source model), email, phone, ID type and number, category, jersey size, parental consent, and BIB.

Retained source rules are:

- Minimum age: 13 for 5K and 17 for 10K.
- Parental consent for runners under 17.
- Name, gender, and jersey size become fixed after registration closes.
- Accepted ID types: KTP, SIM, Passport, KK, KITAS, and Student ID.
- Jersey sizes: S–XXL; BIB is assigned after registration and is non-transferable.

These are retained project assumptions from V3, not newly verified event policies.

The [ordered migrations](../supabase/migrations) define the physical schema. The approved design specifies service-only claim, attachment, and snapshot storage with event and runner ownership checks.

## 6. Main user flows

The organizer prepares a registration and gives the runner its claim code. A trusted operator grants organizer access only to a confirmed account and a specific event. The organizer dashboard and APIs check that event mapping.

The runner signs up, confirms their email, signs in, and redeems the code. From the claimed registration card, they consent to Strava or attach their existing athlete connection. The worker imports eligible activities and builds the snapshot after selection. The runner can open and export a ready showcase, detach the race, or disconnect the athlete account.

The [V4 diagrams](diagrams/v4/README.md) document the superseded chip-first flow. Use the approved November 11 design for the current workflows and data model.

## 7. Decisions and remaining decisions

OD-01 (timing lifecycle), OD-02 (tied placements), and OD-03 (chip split comparisons) concern legacy organizer data. OD-04 is resolved by confirmed Auth accounts and server-owned runner and event-organizer mappings. The November 11 matching, snapshot, detach, and revocation rules supersede the November 2 OD-05 integration resolution.

| ID | Remaining decision | Owner |
| --- | --- | --- |
| OD-06 | Confirm broken-photo behavior and export error/retry wording. The export is a 1080 × 1350 PNG. | Indra / Harry / Shaun |
| OD-07 | Confirm hero-runner replacement rules. | Rakha / Bella |
| OD-08 | Agree performance conditions, usable-state measurement, browser versions, viewport sizes, and navigation starting screens. | Shaun / Bella |

## 8. Links to V3 requirements

This table preserves the original V3 to V4 mapping. The November 11 decision supersedes the chip-first behavior formerly covered by these references. See the requirements register for current coverage.

| V4 section or ID | V3 source |
| --- | --- |
| FR-01–FR-07 | UR-F1, UR-F2, UR-F7; SR-F1–SR-F7, SR-F16–SR-F17, SR-F23 |
| FR-08–FR-11 | UR-F3–UR-F4; SR-F8–SR-F12; SR-NF12 |
| FR-12–FR-13 | UR-F5; SR-F13–SR-F15 |
| FR-14–FR-15 | UR-F6; SR-F18–SR-F19 |
| FR-16–FR-18 | UR-F8–UR-F9; SR-F20–SR-F21, SR-F24 |
| NFR-01–NFR-02 | UR-NF3; SR-NF1–SR-NF2 |
| NFR-03 | UR-NF2; SR-NF3, SR-NF6–SR-NF7 |
| NFR-04–NFR-05 | UR-NF1; SR-NF15–SR-NF17 |
| NFR-06–NFR-07 | SR-NF13–SR-NF14 |
| NFR-08 | UR-NF5; SR-NF18 |
| NFR-09 | SR-F22; SR-NF19 |
| Recommended presentation | UR-D1–UR-D3; SR-D1–SR-D2 |
| Data and business rules | UR-NF4; SR-F4, SR-F10; SR-NF8–SR-NF11; V3 section 3 |
| Main user flows | V3 FS-01–FS-08, consolidated with section 3 |
| Decisions still needed | V3 OD-01–OD-08 |

See [SRS V3](SRS_v3.md) for the historical function forms and diagrams.

## 9. Delivery and review

### Technology and constraints

The selected stack remains Next.js, Tailwind CSS, Next.js API routes, Supabase Postgres and Storage, Strava V3 API, and Vercel. Figma supports design work. API availability and applicable free-tier allowances remain dependencies to verify before the demonstration.

Outside scope: real RFID/GPS hardware, live race-day collection, real payment or registration gateways, facial recognition, additional race categories, multiple events or organizations, automatic social posting, a personalized-link service, and hydration tracking.

### Responsibilities

| Member | Responsibility |
| --- | --- |
| Bella | Requirements, scope, planning, demos, integration, data contract, and risk log. |
| Rakha | Schema, seed data, and hero runners. |
| Embun | Strava activity projection and showcase calculations. |
| Indra | Recap interface, gallery, and export. |
| Harry | Sample content, explanations, SRS, and report. |
| Shaun | Testing, edge cases, and acceptance evidence. |

### Historical delivery schedule before November 11

| Phase | Dates in 2026 | Goal |
| --- | --- | --- |
| Sprint 1 | Sep 22–Oct 18 | Data contract, schema, seeds, and baseline recap. |
| Sprint 2 | Oct 19–Nov 13 | Photos, optional Strava, and export. |
| Sprint 3 | Nov 14–Dec 4 | Visual improvements, hero runners, and report draft. |
| Project closing | Dec 5–Dec 10 | Final fixes and rehearsal; report Dec 8; demo Dec 10. |

These dates carry forward the plan and do not report completed work.

Record current verification against the [acceptance matrix](qa/acceptance-matrix.md). The [validation record](SRS_VALIDATION.md) preserves the V3 review.

## 10. Glossary

| Term | Meaning |
| --- | --- |
| Wrapped | A runner's personal race recap. |
| BIB | The race number assigned to a runner. |
| Pace | Time taken per kilometer. |
| Split | Time for one part of a race; here, one kilometer. |
| DNF | Did not finish. |
| DNS | Did not start; behavior still needs agreement. |
| Cadence | Running step rate; units must follow the selected Strava field. |
| Hero runner | A sample runner with complete demonstration data. |
| Seeded data | Sample records prepared for the prototype. |
| OAuth | The process through which a runner authorizes Strava access. |

**References:** [SRS V3](SRS_v3.md), [requirements engineering lecture notes](lecture-notes/2026-10-01-requirements-engineering.md), [data requirements](DATA_REQUIREMENTS.md), and [ERD](erd.md).

