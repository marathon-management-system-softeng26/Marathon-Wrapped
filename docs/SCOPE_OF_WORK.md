# Scope of Work — Marathon Wrapped

**Version:** 1.0 (draft) · **Date:** September 24, 2026
**Status:** ⏳ Awaiting client approval

This document records what the Marathon Wrapped team agrees to deliver to the client and by when. The full requirements are in [`SRS.md`](SRS.md); this document does not repeat them.

---

## 1. Parties

| Role | Name | Affiliation |
|---|---|---|
| **Client PIC** | Mr. Rafie | Sampoerna University lecturer · PIC for Soekarno Run |
| **Project Manager** | Bella | Marathon Wrapped team |

**Team:** Bella (PM) · Rakha (Database) · Embun (Logic) · Indra (UI/UX) · Harry (Content & Docs) · Shaun (QA)

## 2. Project goal

Build a prototype web app that gives every runner in **Soekarno Run 2027** a personal, shareable, Spotify-Wrapped-style recap of their race. The recap uses chip timing data, with optional Strava metrics and race photos matched by bib number.

## 3. Deliverables

| # | Deliverable | Due |
|---|---|---|
| D1 | Working web prototype (Wrapped cards, FotoYu gallery, Strava opt-in, share as image) | Dec 4, 2026 |
| D2 | Live demo using 3–5 hero runners | Fri, Dec 4, 2026 |
| D3 | Software Requirements Specification (`SRS.md`) | Dec 4, 2026 |
| D4 | Final project report | Dec 4, 2026 |

## 4. Scope

**In scope**
- Single event: Soekarno Run 2027, categories **5K and 10K**
- Wrapped recap from seeded chip data: finish time, pace, category and overall rank, per-km splits and insights
- Optional Strava connection (real free-tier Strava V3 API)
- Simulated FotoYu photo gallery, with photos mapped to bib numbers manually
- Export and share the Wrapped card as an image
- Basic organizer view of all runners' results

**Out of scope**
- Real RFID/GPS timing hardware or race-day data
- Real payment or registration gateway
- Facial recognition for photo matching
- Categories beyond 5K and 10K
- Multiple events or organizations
- A production deployment for real runners

## 5. Timeline

| Sprint | Dates | Outcome |
|---|---|---|
| Sprint 1 — Core | Sep 28 – Oct 16 | Data contract locked; schema and seed data; cards show baseline chip stats |
| Sprint 2 — Polishing | Oct 19 – Nov 13 | FotoYu photos and Strava opt-in added; share/export works |
| Sprint 3 — Hardening | Nov 16 – Dec 4 | Visual polish; hero runners seeded; report finished |
| Demo | Fri, Dec 4 | Live presentation |

Full breakdown: [`ROADMAP.md`](../ROADMAP.md).

## 6. Acceptance criteria

The client accepts the project when:
1. Each of the 3–5 hero runners can open their Wrapped and go through every card without errors.
2. A runner without Strava data or photos still gets a complete card that displays correctly.
3. A runner can export their Wrapped card as an image.
4. The app works on both phone and desktop screen widths.
5. The SRS and final report are submitted.

## 7. Communication

- **Client PIC:** Mr. Rafie. **Team contact:** Bella (PM).
- **Meetings:** as needed, at least one per sprint. Notes are kept in [`meetings/`](meetings/).
- **Channel:** _TBD (e.g. WhatsApp / email)_

## 8. Change requests

Any new feature or change requested after this scope is approved:
1. is recorded in that meeting's notes under **Scope changes**;
2. is checked by the PM against the timeline;
3. is added to this document and the SRS only once the client and PM agree.

## 9. Approval

| | Name | Date | Approved |
|---|---|---|---|
| Client PIC | Mr. Rafie | | ☐ |
| Project Manager | Bella | | ☐ |

## Change log

| Version | Date | Change |
|---|---|---|
| 1.0 (draft) | Sep 24, 2026 | First draft after the kickoff meeting (Sep 23) |
