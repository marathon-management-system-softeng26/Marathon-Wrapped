# Software Requirements Specification (SRS)

## Marathon Wrapped

**Course:** Software Engineering — Sampoerna University × University of Arizona  
**Demo Scenario:** Soekarno Run 2027  
**Version:** 1.1  
**Date:** September 29, 2026

---

## 1. Introduction

### 1.1 Purpose

This document specifies the requirements for **Marathon Wrapped**, a prototype web application that generates a personal, shareable, Spotify-Wrapped-style race recap for each runner in the **Soekarno Run** marathon event. It is intended for the project team, including development, QA, and documentation teams, as well as for course evaluation.

### 1.2 Scope

Marathon Wrapped provides every registered runner with a personalized recap card generated from baseline timing-chip data, including finish time, pace, category rank, and split performance. Runners who want a richer recap can optionally connect **Strava** to enrich their card with health metrics such as heart rate, elevation, cadence, and calories. Race photos are surfaced through a simulated **FotoYu**-style photo marketplace and matched to runners using their bib numbers. Runners can export and share their completed recap card as an image.

This is a **prototype**, not a production system:

- Timing-chip data is **seeded** and is not read from real race-day hardware.
- FotoYu is **simulated**; sample photos are manually mapped to bib numbers, and no facial recognition is implemented.
- Strava integration uses the **real, free-tier Strava V3 API**.
- The deliverable consists of a working prototype, a live demo, and this documentation; it is not intended to be a deployed production service.

### 1.3 Intended Audience

The intended audience includes project team members (PM, database, logic, UI/UX, content/docs, and QA), course instructors, and graders.

### 1.4 Definitions

| Term | Meaning |
| --- | --- |
| Wrapped | The personalized recap card and experience generated for each runner |
| Chip result | Baseline timing data obtained from the simulated bib chip |
| FotoYu | Simulated race-photo marketplace with photos mapped to bib numbers |
| Hero runner | A seeded runner with complete, rich data used for demonstration purposes |
| DNF | Did Not Finish |
| User requirement | A requirement describing what a user needs the system to do or the quality of the experience |
| System requirement | A technical, testable requirement describing how the software shall implement a user requirement |

---

## 2. Overall Description

### 2.1 Product Perspective

Marathon Wrapped is a standalone web application that is not integrated with a live race-timing system. It is demonstrated using a simulated event, Soekarno Run 2027, with two race categories: 5K and 10K.

### 2.2 Product Functions

The system shall:

- Generate a personalized Wrapped card from chip timing data for every runner.
- Allow a runner to optionally connect their Strava account for additional data.
- Surface race photos matched to the runner's bib number through a simulated FotoYu marketplace.
- Allow a runner to export and share their Wrapped card as an image.
- Allow an organizer to view runner results and manage seeded hero runners within the prototype scope.

### 2.3 User Classes

| User | Description |
| --- | --- |
| Runner | Registered participant who can view their own Wrapped and optionally connect Strava |
| Organizer | User who can view aggregate data and manage seeded events, categories, and hero runners within the prototype scope |

### 2.4 Operating Environment

The application is a web application built with a Next.js frontend and backend, a Supabase database, and Vercel hosting. It runs in modern web browsers and supports both desktop and mobile screen widths.

### 2.5 Design & Implementation Constraints

- The project uses low-budget, free-tier tooling only, including the Supabase free tier, Vercel free tier, and Strava free API tier.
- The system does not include a real payment gateway, real RFID/chip hardware, or facial recognition.
- The prototype is limited to a single event, **Soekarno Run 2027**, with two categories: 5K and 10K.

### 2.6 Assumptions & Dependencies

- Strava's free-tier API remains available and within its applicable rate limits throughout the demo.
- Sample/seed data is used as a substitute for real race-day data capture.
- Hero runners are pre-seeded with complete data to ensure a reliable live demonstration.

---

## 3. Data Requirements

### 3.1 Runner Registration Data

| Field | Type | Notes |
| --- | --- | --- |
| Full legal name | text | Must match the runner's ID; immutable after registration closes |
| Date of birth | date | Used to calculate age and determine category eligibility |
| Gender | enum (M/F) | Immutable after registration closes |
| Email address | text | Used for registration confirmation |
| Phone number | text | Used for contact |
| ID type | enum | KTP, SIM, Passport, KK, KITAS, or Student ID |
| ID number | text | Verified against the selected ID type during race pack collection |
| Race category | enum | 5K or 10K |
| Jersey size | enum | S–XXL; immutable after registration closes |
| Parental consent | boolean/file | Required if the runner is under 17 |
| BIB number | text (unique) | Assigned after registration and is non-transferable |

**Age eligibility:**

- 5K: minimum age 13
- 10K: minimum age 17

### 3.2 Baseline / Optional Data

| Data Type | Source | Required? |
| --- | --- | --- |
| Chip timing (start, finish, splits) | Simulated bib chip | Required for every finisher |
| Strava metrics (HR, elevation, cadence, calories) | Strava V3 API (opt-in) | Optional |
| FotoYu photos | Simulated marketplace, mapped by bib number | Optional |

### 3.3 Entity Overview

- **events** — event_id, name, event_date, location
- **categories** — category_id, event_id (FK), name (5K/10K), distance_km, min_age
- **runners** — runner_id, category_id (FK), bib_number (unique), name, gender, date_of_birth, id_type, id_number, email, phone
- **chip_results** — result_id, runner_id (FK, unique), start_time, finish_time, elapsed_seconds, avg_pace_sec_km, category_rank, overall_rank, finisher (bool)
- **chip_splits** — split_id, runner_id (FK), km_marker, split_seconds
- **strava_metrics** — metric_id, runner_id (FK, unique), avg_heartrate, max_heartrate, elevation_gain_m, calories, avg_cadence
- **fotoyu_photos** — photo_id, bib_number (FK), photo_url, photographer, captured_km, captured_at

### 3.4 Relationships

- One **event** → many **categories** (1:N)
- One **category** → many **runners** (1:N)
- One **runner** → exactly one **chip_results** record (1:1)
- One **runner** → many **chip_splits** records, one per kilometer (1:N)
- One **runner** → zero or one **strava_metrics** record (1:0..1, optional)
- One **runner**, identified via bib_number → zero or many **fotoyu_photos** records (1:0..N, optional)

Full schema: see `db/schema.sql`.

---

# 4. User Requirements

User requirements describe the observable needs of the two supported user classes. Each requirement is written so that it can be verified during acceptance testing.

## 4.1 User Functional Requirements

| ID | User requirement | Acceptance measure |
| --- | --- | --- |
| **UR-F1** | A runner shall be able to view a personalized Wrapped containing their finish time, average pace, category rank, overall rank, and split information. | For every seeded finisher, all 5 baseline information types are displayed on the runner's Wrapped. |
| **UR-F2** | A runner shall be able to view split-based performance insights. | The Wrapped displays at least the fastest kilometer and whether the runner's later splits were faster or slower than earlier splits. |
| **UR-F3** | A runner shall be able to connect Strava voluntarily to enrich the Wrapped with available running metrics. | After successful OAuth connection, the system displays available heart rate, elevation, calories, and cadence data; no Strava connection is required to view the baseline Wrapped. |
| **UR-F4** | A runner shall be able to disconnect Strava and continue using the baseline Wrapped. | After disconnection, the baseline chip data remains viewable and Strava metrics are no longer displayed as connected data. |
| **UR-F5** | A runner shall be able to view race photos associated with their BIB number. | If matching photos exist, they are displayed in a gallery; if none exist, the Wrapped still opens and displays a no-photo state. |
| **UR-F6** | A runner shall be able to export and share their completed Wrapped as an image. | A successful export produces an image file containing the personalized Wrapped card. |
| **UR-F7** | A runner with DNF status shall still be able to access a valid Wrapped experience without misleading finish-time information. | A DNF test record renders without an application error and does not display a fabricated finish time or pace. |
| **UR-F8** | An organizer shall be able to view runner results for the demonstration event. | The organizer can access results for all seeded runners in the Soekarno Run 2027 dataset. |
| **UR-F9** | An organizer shall be able to manage the seeded hero runners used for demonstration. | The organizer can create, update, or replace hero-runner demonstration data without modifying the application's source code. |

## 4.2 User Non-Functional Requirements

| ID | User requirement | Acceptance measure |
| --- | --- | --- |
| **UR-NF1** | The Wrapped experience shall be usable on desktop and mobile screen widths. | The core Wrapped view and export action remain usable at both desktop and mobile viewport sizes used in QA testing. |
| **UR-NF2** | The Wrapped shall remain usable when optional data is unavailable. | Removing Strava data or photo data from a test runner does not prevent the baseline Wrapped from rendering. |
| **UR-NF3** | The Wrapped shall provide a responsive experience with acceptable loading time. | A seeded runner's Wrapped shall become usable within **3 seconds** on the agreed test connection and environment. |
| **UR-NF4** | Runner BIB information shall remain consistent and trustworthy. | No two runners may have the same BIB number, and an assigned BIB number shall not change during normal runner-data updates. |
| **UR-NF5** | The prototype shall remain affordable to operate within the project constraints. | All required third-party services used for the prototype shall operate within their available free tiers during the demonstration period. |

---

# 5. System Requirements

System requirements translate the user requirements into specific, implementation-level behaviours that can be verified by QA.

## 5.1 System Functional Requirements

### 5.1.1 Runner and Result Data

- **SR-F1:** The system shall retrieve one `chip_results` record for each runner with a valid result.
- **SR-F2:** The system shall calculate `elapsed_seconds` as `finish_time - start_time` for a finisher.
- **SR-F3:** The system shall calculate `avg_pace_sec_km` as `elapsed_seconds / distance_km`, using the runner's category distance.
- **SR-F4:** The system shall store one split record per kilometre marker for each seeded finisher.
- **SR-F5:** The system shall calculate category and overall rankings from finisher elapsed time in ascending order.
- **SR-F6:** The system shall mark a runner as `finisher = false` when no valid finish time is available and shall not calculate a finish pace for that runner.
- **SR-F7:** The system shall generate split insights from the stored split records, including the fastest kilometre and a comparison of earlier versus later split performance.

### 5.1.2 Strava Integration

- **SR-F8:** The system shall initiate Strava OAuth 2.0 only after the runner explicitly selects the connect action.
- **SR-F9:** For a successfully connected runner, the system shall retrieve the available Strava values for average heart rate, maximum heart rate, elevation gain, calories, and average cadence.
- **SR-F10:** The system shall store at most one active `strava_metrics` record per runner.
- **SR-F11:** The system shall allow the runner to disconnect Strava and remove or invalidate the associated connection data.
- **SR-F12:** A failed, unavailable, or incomplete Strava response shall not prevent baseline chip data from being rendered.

### 5.1.3 Photo Matching

- **SR-F13:** The system shall match FotoYu records to runners using the unique `bib_number`.
- **SR-F14:** The system shall display all available photo records returned for the runner's BIB.
- **SR-F15:** When zero photo records are returned, the system shall display a no-photo state and continue rendering the remainder of the Wrapped.

### 5.1.4 Wrapped Generation and Export

- **SR-F16:** The system shall combine chip data, calculated insights, optional Strava metrics, and optional photos into one runner-specific Wrapped view.
- **SR-F17:** The system shall generate the Wrapped using the runner's unique identifier/BIB and shall not mix data between runners.
- **SR-F18:** The export function shall generate an image containing the rendered Wrapped card for the selected runner.
- **SR-F19:** An export failure shall display an actionable error state and shall not remove or corrupt the runner's stored result data.

### 5.1.5 Organizer Functions

- **SR-F20:** The organizer view shall retrieve the runner results for the selected prototype event.
- **SR-F21:** The organizer shall be able to create or update seeded hero-runner data through the supported management interface.
- **SR-F22:** The system shall support at least **3 hero runners** with complete chip, Strava, and photo data for demonstration testing.

## 5.2 System Non-Functional Requirements

### 5.2.1 Performance

- **SR-NF1:** For the agreed seeded dataset and test environment, the runner's Wrapped page shall reach a usable state within **3 seconds** for at least **95% of 20 consecutive page-load tests**.
- **SR-NF2:** The system shall not make unnecessary repeated requests for the same runner data during a single Wrapped page load.

### 5.2.2 Resilience and Availability of Core Functions

The resilience requirements follow the principle that systems should recognise problems, resist failure where possible, recover critical services, and reinstate normal operation. The project materials also emphasise planning for disruptive events and preparing recovery strategies.

- **SR-NF3:** If Strava data is unavailable, the system shall still render the baseline Wrapped containing chip timing data and split insights.
- **SR-NF4:** If no photo records are available, the system shall still render the baseline Wrapped without a server or client-side application error.
- **SR-NF5:** If a runner is marked DNF, the system shall render a valid DNF state without calculating or displaying a fabricated finish time or pace.
- **SR-NF6:** For each resilience test above, the system shall recover to a usable Wrapped view without requiring a page-wide application restart.
- **SR-NF7:** The project test suite shall include at least **one test case each** for missing Strava data, missing photo data, and DNF data.

### 5.2.3 Data Integrity

- **SR-NF8:** The database shall enforce `bib_number` uniqueness.
- **SR-NF9:** The system shall prevent a normal runner update from changing an assigned `bib_number`.
- **SR-NF10:** Foreign-key relationships shall prevent orphaned chip-result, split, Strava, and photo records where the corresponding runner does not exist.
- **SR-NF11:** A runner shall have no more than one `chip_results` record and no more than one `strava_metrics` record.

### 5.2.4 Security and Privacy

- **SR-NF12:** Strava connection shall require explicit user authorization through OAuth 2.0.
- **SR-NF13:** Strava credentials or access tokens shall not be displayed in the runner-facing Wrapped.
- **SR-NF14:** Organizer-only functions shall not be exposed as runner functions in the application interface.

### 5.2.5 Usability and Compatibility

- **SR-NF15:** The core Wrapped view shall be usable at both mobile and desktop viewport sizes supported by the project.
- **SR-NF16:** The runner shall be able to reach the Wrapped, Strava connection action, photo gallery, and export action without requiring more than **3 navigation steps** from the relevant starting screen.
- **SR-NF17:** The application shall support the modern desktop and mobile browsers selected by the QA team for the final demonstration.

### 5.2.6 Cost and Demonstrability

- **SR-NF18:** Required third-party services shall remain within their applicable free-tier limits during the project demonstration.
- **SR-NF19:** The seeded dataset shall contain at least **3 complete hero runners** and shall include at least one test runner for each of the following edge cases: DNF, no Strava data, and no photo data.

---

# 6. Requirements Traceability

The following mapping connects user needs to the technical requirements that implement them.

| User requirement | Supporting system requirements |
| --- | --- |
| UR-F1 | SR-F1 to SR-F7, SR-F16 to SR-F17 |
| UR-F2 | SR-F4, SR-F7 |
| UR-F3 | SR-F8 to SR-F10 |
| UR-F4 | SR-F11 to SR-F12 |
| UR-F5 | SR-F13 to SR-F15 |
| UR-F6 | SR-F18 to SR-F19 |
| UR-F7 | SR-F6, SR-NF5 to SR-NF7 |
| UR-F8 | SR-F20 |
| UR-F9 | SR-F21 to SR-F22 |
| UR-NF1 | SR-NF15 to SR-NF17 |
| UR-NF2 | SR-NF3 to SR-NF7 |
| UR-NF3 | SR-NF1 to SR-NF2 |
| UR-NF4 | SR-NF8 to SR-NF11 |
| UR-NF5 | SR-NF18 to SR-NF19 |

---

# 7. Tech Stack

| Layer | Choice |
| --- | --- |
| UI/UX design | Figma (wireframes and card designs) |
| Frontend | Next.js + Tailwind CSS |
| Backend | Next.js API routes |
| Database | Supabase (Postgres) |
| Photo storage | Supabase Storage |
| Enrichment | Strava V3 API |
| Hosting | Vercel |

---

# 8. Team & Responsibilities

| Member | Role | Owns |
| --- | --- | --- |
| Bella | PM | Requirements, scope, planning & demos; data contract between members; integration; risk log |
| Rakha | Database | Schema, seed data, hero runners |
| Embun | Logic | Wrapped computation, ranking, and merging of chip/Strava/photo data |
| Indra | UI/UX | The Wrapped card experience, gallery, and share/export functionality |
| Harry | Content & Docs | Sample data, microcopy, SRS/report |
| Shaun | QA | Per-sprint testing and edge cases |

---

# 9. Timeline

The project consists of **three sprints (4, 4 and 3 weeks) followed by Project Closing**, running from **September 22 to December 10, 2026**.

| Sprint | Dates | Goal |
| --- | --- | --- |
| Sprint 1 — Core | Sep 22 – Oct 18 | Lock the data contract; complete the schema and seed data; render cards with baseline chip statistics |
| Sprint 2 — Polishing | Oct 19 – Nov 13 | Integrate FotoYu photos and Strava opt-in functionality; implement share/export functionality |
| Sprint 3 — Hardening | Nov 14 – Dec 4 | Complete the visual polish pass; seed hero runners; draft the report |
| Project Closing | Dec 5 – Dec 10 | Final fixes and a dress rehearsal; submit the final report on Tuesday, Dec 8; live demonstration on Thursday, Dec 10 |

Full breakdown, ownership per sprint, and risk log: see `ROADMAP.md`.

---

# 10. Out of Scope

The following are outside the scope of the prototype:

- Real RFID/GPS timing hardware
- Real payment/registration gateway
- Facial recognition for photo matching
- Categories beyond 5K and 10K
- Multi-event or multi-organization support

---

# 11. References

See `REFERENCES.md` for the full list of sourced links, including Soekarno Run registration and eligibility rules, Strava API documentation, and comparable race-technology systems.
