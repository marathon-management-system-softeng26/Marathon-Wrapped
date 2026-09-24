# Data Requirements

Runner data requirements for the ERD, based on real-world registration standards from the Soekarno Run series (Jakarta, Bandung, Malang, and Solo editions, 2025–2026), adapted for the Marathon Wrapped MVP prototype for the Soekarno Run 2027 demo scenario.

## 1. Runner Registration Data

The following fields are collected during registration and are based on official Soekarno Run race requirements:

| Field | Type | Notes |
| ----- | ----- | ----- |
| Full legal name | text | Must match the runner's ID; cannot be changed after registration closes |
| Date of birth | date | Used to calculate age and determine category eligibility |
| Gender | enum (M/F) | Cannot be changed after registration closes |
| Email address | text | Used for registration confirmation |
| Phone number | text | Used for contact and emergency purposes |
| ID type | enum | KTP, SIM, Passport, KK, KITAS, or Student ID |
| ID number | text | Matched against the selected ID type during race pack collection |
| Race category | enum | 5K or 10K |
| Jersey size | enum | S–XXL; cannot be changed after registration closes |
| Parental consent form | boolean / file | Required if the runner is under 17 (the 5K category allows runners aged 13+) |
| BIB number | text (unique) | Assigned after registration; non-transferable and must be worn on the runner's chest |

### Age Eligibility by Category

According to the Soekarno Run standard:

* **5K:** minimum age 13
* **10K:** minimum age 17

### Race-Day Conduct Rules Relevant to Data Design

The following race-day rules are relevant to the system's data design:

* **BIB numbers cannot be transferred or sold.** The system should therefore treat `bib_number` as permanently bound to one runner for the duration of the event.
* **Runners who are more than 10 minutes late to the start line are not permitted to start.** If gate logic is simulated, this may justify a `start_status` field with values such as `on-time`, `late`, or `dns`.
* **Timing chips must not be bent or damaged.** This implies that chip data may occasionally be missing or invalid; therefore, the schema should tolerate null or failed chip reads.

---

## 2. Additional Marathon-related Data

In addition to the registration baseline, the prototype introduces three additional data types:

| Data Type | Source | Required? |
| :---- | :---- | :---- |
| Chip timing (start, finish, splits) | Simulated bib chip | Required |
| Strava metrics (HR, elevation, cadence, calories) | Strava V3 API (opt-in) | Optional |
| FotoYu photos | Simulated photo marketplace, mapped by bib number | Optional |

---

## 3. Entities for the ERD

Based on the existing schema (`db/schema.sql`), the following entities are included in the ERD:

* **events** — event_id, name, event_date, location
* **categories** — category_id, event_id (FK), name (5K or 10K), distance_km, min_age
* **runners** — runner_id, category_id (FK), bib_number (unique), name, gender, date_of_birth, id_type, id_number, email, phone
* **chip_results** — result_id, runner_id (FK, unique), start_time, finish_time, elapsed_seconds, avg_pace_sec_km, category_rank, overall_rank, finisher (bool)
* **chip_splits** — split_id, runner_id (FK), km_marker, split_seconds
* **strava_metrics** — metric_id, runner_id (FK, unique), avg_heartrate, max_heartrate, elevation_gain_m, calories, avg_cadence
* **fotoyu_photos** — photo_id, bib_number (FK), photo_url, photographer, captured_km, captured_at

---

## 4. Relationships for the ERD

* One **event** has many **categories** (1:N).
* One **category** has many **runners** (1:N).
* One **runner** has exactly one **chip_results** row (1:1).
* One **runner** has many **chip_splits** rows, with one row per kilometer (1:N).
* One **runner** has zero or one **strava_metrics** row (1:0..1, optional).
* One **runner**, identified via `bib_number`, has zero or many **fotoyu_photos** rows (1:0..N, optional).

---

## 5. Notes

The registration rules, including ID verification, parental consent, and non-transferable BIB numbers, are documented here to justify why the `runners` table treats `bib_number` as unique and permanent. They also explain why `name`, `category`, and `gender` are effectively immutable after registration in the real-world system. These can be documented as business rules in the schema, even though the prototype does not enforce UI-level locks on these fields.

The 10-minute late-start rule and the requirement to avoid damaged timing chips provide the real-world basis for treating `finisher` as a boolean and allowing `chip_results` to accommodate DNF or missing-data cases gracefully. This also aligns with Sprint 3's edge cases, including no-Strava, no-photo, and empty-state scenarios identified in the roadmap.
