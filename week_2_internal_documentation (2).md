# Week 2 — Internal Documentation & Scope of Work (SOW) Integration

**Documentation Owner:** Harry | **Project Manager:** Marbella  
**Context:** Capstone Project — Software Engineering 2026/2027 (Sampoerna University × University of Arizona)

---

## 1. Scope of Work (SOW) Baseline

The official Scope of Work (SOW) signed on September 24, 2026, defines the contractual framework, deliverables, and boundary conditions for the project.

### Project Stakeholders & Roles
* **Client PIC:** Mr. Rafie (PIC for Soekarno Run)
* **Course Lecturer:** Mr. Panji Dharma (Software Engineering Lecturer, Sampoerna University)
* **Project Manager:** Marbella (IS) — Scope, deliverables, planning & risk log
* **Technical Lead:** Embun (CS) — System architecture & pure logic algorithms (`/lib`)
* **Backend Developer:** Rakhansyah (CS) — PostgreSQL schema, Supabase & seed data (`/db`)
* **Frontend Developer:** Indra (CS) — Next.js UI, Wrapped cards & export functionality (`/app`)
* **Quality Assurance:** Shaun (CS) — Test suites, sprint QA gates & integration tests (`/tests`)
* **Content & Documentation:** Harry (IS) — SRS v1.0, UML diagrams & internal documentation

### Key Deliverables & Schedule
* **D3 (Documentation):** December 8, 2026 — Final project report and supporting documentation.
* **D1 & D2 (System & Demo):** December 10, 2026 — Working web prototype (Wrapped cards, FotoYu gallery, Strava opt-in, image share) and live demonstration using 3–5 hero runners.

### Scope Boundaries
* **In-Scope:** Soekarno Run 2027 (5K and 10K categories); chip timing recap cards (splits, pace, rankings); optional free-tier Strava V3 integration; simulated FotoYu photo marketplace via bib matching; image export/sharing.
* **Out-of-Scope:** Real RFID/GPS timing hardware; real payment/registration gateways; facial recognition photo matching; categories beyond 5K/10K; live production deployment for real runners.

### Sprint Timeline & Acceptance Criteria
* **Sprint 1 (Core):** Sep 22 – Oct 18 — Finalize data contract, schema v5, seed data, and baseline chip cards.
* **Sprint 2 (Polishing):** Oct 19 – Nov 13 — Integrate FotoYu photos, Strava opt-in, and card export/share functionality.
* **Sprint 3 (Hardening):** Nov 16 – Dec 4 — Visual polish pass, hero runner seeding, and final report drafting.
* **Project Closing:** Dec 4 – Dec 10 — Live demonstration rehearsal and document submission.
* **Acceptance Criteria:** All 3–5 hero runners can seamlessly navigate their complete Wrapped experience without errors; missing Strava data or photos degrade gracefully without breaking the card rendering; Wrapped cards can be exported as shareable images across mobile and desktop screen widths.

---

## 2. Client Meeting & Task Coordination

* **Date & Context:** Thursday, 23 September 2026
* **Details:** Discussion with Sir Rafi confirmed client expectations for Soekarno Run 2027. Priorities were aligned to ensure core baseline chip data processing functions before layer-2 integrations (Strava & FotoYu) are attached.
* **Task Dependencies:** Database schema (`/db`) $\rightarrow$ Logic modules (`/lib`) $\rightarrow$ UI components (`/app`) $\rightarrow$ QA verification & testing (`/tests`).

---

## 3. Database Architecture (ERD v5)

The database schema implemented in `db/schema.sql` reflects ERD v5 (PostgreSQL on Supabase using UUID primary keys for runner entities):

* `events` (bigint primary key) — Race event details (e.g., Soekarno Run 2027). 1:N with categories.
* `categories` (bigint primary key) — 5K (min age 13) and 10K (min age 17) distance categories. 1:N with runners.
* `runners` (uuid primary key) — Participant profiles with unique `bib_number`, `date_of_birth`, and `parental_consent`. 1:N with categories.
* `chip_results` (uuid primary key) — 1:1 mandatory baseline timing (start/finish times, ranks, pace, finisher status). Tolerates DNF/DNS.
* `chip_splits` (uuid primary key) — 1:N split times per kilometer. Drives pacing insights and fastest km calculations.
* `strava_metrics` (uuid primary key) — 1:0..1 optional heart rate, elevation, cadence, and calorie metrics via Strava OAuth.
* `fotoyu_photos` (uuid primary key) — 1:0..N race photos matched to runners via `bib_number` string identifier.

### Key SQL Functions & Views
* **Triggers:** `check_runner_eligibility()` validates minimum age limits (13 for 5K, 17 for 10K) and parental consent; `lock_bib_number()` enforces immutable BIB assignments.
* **Analytical View:** `runner_wrapped` consolidates runner statistics, photo counts, Strava flags, and category percentiles (via `percent_rank()`) into a single query payload.

---

## 4. Codebase Architecture & Repository Setup

The main branch (`marathon-management-system-softeng26/Marathon-Wrapped`) serves as the technical realization of the SOW and ERD:

* `/app`: Next.js App Router core containing `layout.tsx` (Geist fonts, root metadata), `globals.css` (Tailwind CSS v4 theme), and `page.tsx` (Wrapped landing page).
* `/db`: Database layer managed by Rakhansyah (`schema.sql`, `seed.sql`, `reset.sql`, and Supabase execution rules).
* `/docs`: Single source of truth managed by Marbella and Harry (`DATA_REQUIREMENTS.md`, `data-contract.md`, ERD v5, SRS v1.0, UML diagrams, `microcopy.md`, `demo-script.md`).
* `/lib`: Pure TypeScript logic managed by Embun (`stats.ts`, `insights.ts`, `merge.ts`, `supabase.ts`) turning raw DB queries into Wrapped card payloads.
* `/public/photos`: Static race media assets and photo placeholders.
* `/tests`: Testing & QA suite owned by Shaun. Contains test plans (`test-plan.md`), sprint QA gate logs (`qa-sprint-1/2/3.md`), integration checks (`integration-check.md`), and automated unit tests for `/lib` (`stats.test.ts`).

---

## 5. Action Items & Summary

* Deploy `schema.sql` and seed data onto Supabase (Rakhansyah).
* Finalize pure TypeScript logic in `/lib` following `data-contract.md` (Embun).
* Connect Next.js UI components to `/lib` data pipelines (Indra).
* Execute Sprint 1 QA gate checks and automated unit tests for `/lib` in `/tests` (Shaun).

Week 2 successfully achieved full alignment across client SOW commitments, internal task division, ERD v5 database definitions, main branch repository architecture, and QA testing protocols in `/tests`. The team is on schedule to deliver Sprint 1 milestones.