# Software Requirements Specification (SRS)

## Marathon Wrapped

**Course:** Software Engineering — Sampoerna University × University of Arizona  
**Demo Scenario:** Soekarno Run 2027  
**Version:** 1.0  
**Date:** September 24, 2026

---

## 1. Introduction

### 1.1 Purpose

This document specifies the requirements for **Marathon Wrapped**, a prototype web application that generates a personal, shareable, Spotify-Wrapped-style race recap for each runner in the **Soekarno Run** marathon event. It is intended for the project team, including development, QA, and documentation teams, as well as for course evaluation.

### 1.2 Scope

Marathon Wrapped provides every registered runner with a personalized recap card generated from baseline timing-chip data, including finish time, pace, category rank, and split performance. Runners who want a richer recap can optionally connect **Strava** to enrich their card with health metrics such as heart rate, elevation, cadence, and calories. Race photos are surfaced through a simulated **FotoYu**-style photo marketplace and matched to runners using their bib numbers. Runners can export and share their completed recap card as an image.

This is a **prototype**, not a production system:

* Timing-chip data is **seeded** and is not read from real race-day hardware.
* FotoYu is **simulated**; sample photos are manually mapped to bib numbers, and no facial recognition is implemented.
* Strava integration uses the **real, free-tier Strava V3 API**.
* The deliverable consists of a working prototype, a live demo, and this documentation; it is not intended to be a deployed production service.

### 1.3 Intended Audience

The intended audience includes project team members (PM, database, logic, UI/UX, content/docs, and QA), course instructors, and graders.

### 1.4 Definitions

| Term | Meaning |
| ----- | ----- |
| Wrapped | The personalized recap card and experience generated for each runner |
| Chip result | Baseline timing data obtained from the simulated bib chip |
| FotoYu | Simulated race-photo marketplace with photos mapped to bib numbers |
| Hero runner | A seeded runner with complete, rich data used for demonstration purposes |
| DNF | Did Not Finish |

---

## 2. Overall Description

### 2.1 Product Perspective

Marathon Wrapped is a standalone web application that is not integrated with a live race-timing system. It is demonstrated using a simulated event, Soekarno Run 2027, with two race categories: 5K and 10K.

### 2.2 Product Functions (Summary)

The system shall:

* Generate a personalized Wrapped card from chip timing data for every runner.
* Allow a runner to optionally connect their Strava account for additional data.
* Surface race photos matched to the runner's bib number through a simulated FotoYu marketplace.
* Allow a runner to export and share their Wrapped card as an image.

### 2.3 User Classes

| User | Description |
| ----- | ----- |
| Runner | Registered participant who can view their own Wrapped and optionally connect Strava |
| Organizer | User who can view aggregate data and manage seeded events, categories, and hero runners within the prototype scope |

### 2.4 Operating Environment

The application is a web application built with a Next.js frontend and backend, a Supabase database, and Vercel hosting. It runs in modern web browsers and supports both desktop and mobile screen widths.

### 2.5 Design & Implementation Constraints

* The project uses low-budget, free-tier tooling only, including the Supabase free tier, Vercel free tier, and Strava free API tier.
* The system does not include a real payment gateway, real RFID/chip hardware, or facial recognition.
* The prototype is limited to a single event, **Soekarno Run 2027**, with two categories: 5K and 10K.

### 2.6 Assumptions & Dependencies

* Strava's free-tier API remains available and within its applicable rate limits throughout the demo.
* Sample/seed data is used as a substitute for real race-day data capture.
* Hero runners are pre-seeded with complete data to ensure a reliable live demonstration.

---

## 3. Data Requirements

Real-world registration and eligibility rules are based on the Soekarno Run series (see `REFERENCES.md`) and are scoped to the two categories used in this project.

### 3.1 Runner Registration Data

| Field | Type | Notes |
| ----- | ----- | ----- |
| Full legal name | text | Must match the runner's ID; immutable after registration closes |
| Date of birth | date | Used to calculate age and determine category eligibility |
| Gender | enum (M/F) | Immutable after registration closes |
| Email address | text | Used for registration confirmation |
| Phone number | text | Used for contact |
| ID type | enum | KTP, SIM, Passport, KK, KITAS, or Student ID |
| ID number | text | Verified against the selected ID type during race pack collection |
| Race category | enum | 5K or 10K |
| Jersey size | enum | S–XXL; immutable after registration closes |
| Parental consent | boolean/file | Required if the runner is under 17 (5K allows runners aged 13+) |
| BIB number | text (unique) | Assigned after registration and is non-transferable |

**Age eligibility:**

* 5K: minimum age 13
* 10K: minimum age 17

### 3.2 Baseline / Optional Data

| Data Type | Source | Required? |
| ----- | ----- | ----- |
| Chip timing (start, finish, splits) | Simulated bib chip | Required for every finisher |
| Strava metrics (HR, elevation, cadence, calories) | Strava V3 API (opt-in) | Optional |
| FotoYu photos | Simulated marketplace, mapped by bib number | Optional |

### 3.3 Entity Overview

* **events** — event_id, name, event_date, location
* **categories** — category_id, event_id (FK), name (5K/10K), distance_km, min_age
* **runners** — runner_id, category_id (FK), bib_number (unique), name, gender, date_of_birth, id_type, id_number, email, phone
* **chip_results** — result_id, runner_id (FK, unique), start_time, finish_time, elapsed_seconds, avg_pace_sec_km, category_rank, overall_rank, finisher (bool)
* **chip_splits** — split_id, runner_id (FK), km_marker, split_seconds
* **strava_metrics** — metric_id, runner_id (FK, unique), avg_heartrate, max_heartrate, elevation_gain_m, calories, avg_cadence
* **fotoyu_photos** — photo_id, bib_number (FK), photo_url, photographer, captured_km, captured_at

### 3.4 Relationships (ERD Basis)

* One **event** → many **categories** (1:N)
* One **category** → many **runners** (1:N)
* One **runner** → exactly one **chip_results** record (1:1)
* One **runner** → many **chip_splits** records, one per kilometer (1:N)
* One **runner** → zero or one **strava_metrics** record (1:0..1, optional)
* One **runner**, identified via bib_number → zero or many **fotoyu_photos** records (1:0..N, optional)

Full schema: see `db/schema.sql`.

---

## 4. Functional Requirements

### **Chip Timing (Baseline, Every Runner)**

* **FR1:** The system shall record a start time and finish time for each runner.
* **FR2:** The system shall calculate elapsed time and average pace for each runner.
* **FR3:** The system shall calculate the category rank and overall rank for each runner.
* **FR4:** The system shall record per-kilometer splits for each runner.
* **FR5:** The system shall generate insight text from split data, including the fastest kilometer, negative/positive split performance, and points at which the runner slowed down.
* **FR6:** The system shall handle a non-finisher (DNF) without causing the Wrapped card to fail.

### **Strava Enrichment (Opt-In)**

* **FR7:** A runner shall be able to connect their Strava account through OAuth 2.0.
* **FR8:** The system shall retrieve heart rate, elevation, calories, and cadence data for a connected runner through the Strava V3 API.
* **FR9:** The Wrapped card shall display Strava metrics when they are available and shall render correctly when they are absent.
* **FR10:** A runner shall be able to disconnect their Strava account.

### **FotoYu Photo Marketplace (Simulated)**

* **FR11:** The system shall map race photos to a runner's bib number.
* **FR12:** The Wrapped card shall display a gallery of photos matched to the runner's bib number.
* **FR13:** The system shall handle runners with zero matched photos without causing the Wrapped card to fail.

### **Wrapped Card & Sharing**

* **FR14:** The system shall render a personalized Wrapped card that combines chip data, Strava data (if available), and photo data.
* **FR15:** A runner shall be able to export and share their Wrapped card as an image.

### **Admin / Organizer (Prototype Scope)**

* **FR16:** An admin shall be able to view all runners' results for an event.
* **FR17:** An admin shall be able to seed and manage hero runners with complete demonstration data.

---

## 5. Non-Functional Requirements

* **NFR1 (Budget):** All third-party services shall provide a workable free tier.
* **NFR2 (Usability):** The Wrapped card shall be viewable and shareable on both desktop and mobile screen widths.
* **NFR3 (Resilience):** The card shall degrade gracefully; missing Strava or photo data shall not prevent the card from rendering correctly.
* **NFR4 (Performance):** A Wrapped card shall load within 3 seconds on a typical broadband connection for the seeded data volumes.
* **NFR5 (Data Integrity):** A `bib_number` shall be unique and immutable once assigned, in accordance with real-world non-transferability rules.
* **NFR6 (Demonstrability):** At least 3–5 "hero" runners shall have complete data (chip + Strava + photos) to ensure a strong live demonstration.

---

## 6. Tech Stack

| Layer | Choice |
| ----- | ----- |
| Frontend | Next.js + Tailwind CSS |
| Backend | Next.js API routes |
| Database | Supabase (Postgres) |
| Photo storage | Supabase Storage |
| Enrichment | Strava V3 API |
| Hosting | Vercel |

---

## 7. Team & Responsibilities

| Member | Role | Owns |
| ----- | ----- | ----- |
| Bella | PM | Requirements, scope, planning & demos; data contract between members; integration; risk log |
| Rakha | Database | Schema, seed data, hero runners |
| Embun | Logic | Wrapped computation, ranking, and merging of chip/Strava/photo data |
| Indra | UI/UX | The Wrapped card experience, gallery, and share/export functionality |
| Harry | Content & Docs | Sample data, microcopy, SRS/report |
| Shaun | QA | Per-sprint testing and edge cases |

---

## 8. Timeline

The project consists of **three sprints (3, 4 and 3 weeks), with the last week of Sprint 3 as demo week**, running from **September 28 to December 4, 2026**.

| Sprint | Dates | Goal |
| ----- | ----- | ----- |
| Sprint 1 — Core | Sep 28 – Oct 16 | Lock the data contract; complete the schema and seed data; render cards with baseline chip statistics |
| Sprint 2 — Polishing | Oct 19 – Nov 13 | Integrate FotoYu photos and Strava opt-in functionality; implement share/export functionality |
| Sprint 3 — Hardening | Nov 16 – Dec 4 | Complete the visual polish pass; seed hero runners; draft the report |
| Demo Week (last week of Sprint 3) | Nov 30 – Dec 4 | Finalize the report, conduct a dress rehearsal, and present on Friday, Dec 4 |

Full breakdown, ownership per sprint, and risk log: see `ROADMAP.md`.

---

## 9. Out of Scope

The following are outside the scope of the prototype:

* Real RFID/GPS timing hardware
* Real payment/registration gateway
* Facial recognition for photo matching
* Categories beyond 5K and 10K
* Multi-event or multi-organization support

---

## 10. References

See `REFERENCES.md` for the full list of sourced links, including Soekarno Run registration and eligibility rules, Strava API documentation, and comparable race-technology systems.
