# Marathon Wrapped — Roadmap 🗺️

Sprint plan, team roles, and risk log for **Marathon Wrapped** — a Spotify-Wrapped-style runner recap app, demoed for **Soekarno Run 2027**.

> Prototype for the **Sampoerna University × University of Arizona** Software Engineering course — not production grade. Deliverable: working prototype + live demo + documentation report. Timeline: **Sep 22 – Dec 10, 2026**: three sprints (4, 4 and 3 weeks), then Project Closing (Dec 5 – Dec 10) for report submission and the live demo.

## Team & roles

| Member | Role | Owns |
|---|---|---|
| Bella | PM | Requirements, scope, planning & demos; the data contract between members; integration; risk log |
| Rakha | Database | Schema + seeded data (`runners`, `chip_results` with per-km splits, `strava_metrics`, `fotoyu_photos`); hero-runner seed set |
| Embun | Logic | Wrapped computation — ranking/percentile, split analysis, insight lines; merging chip + Strava + photos per runner |
| Indra | UI/UX | The Wrapped card sequence (animated, swipeable, shareable), FotoYu gallery, share/export-as-image |
| Harry | Content & docs | Sample data (realistic runners, believable splits, photos→bibs), card microcopy, SRS + report |
| Shaun | QA | End-of-sprint test pass against each goal; edge cases (no-Strava, no-photos, empty states); bug log feeding next sprint |

**The one contract to lock in Sprint 1:** the per-runner data object passed **Rakha → Embun → Indra**. Rakha's seed produces a clean runner object → Embun computes stats onto it → Indra renders it. Agree the field names in week 1 so all three build in parallel without blocking. This is the PM's first priority.

## Sprint overview

| Sprint | Dates | Goal |
|---|---|---|
| Sprint 1 — Foundation + Core | Sep 22 – Oct 18 | Data contract locked; schema + seed; cards render baseline chip stats |
| Sprint 2 — Enrichment + Share | Oct 19 – Nov 13 | FotoYu photos + Strava opt-in layered in; share/export works |
| Sprint 3 — Polish + Hardening | Nov 14 – Dec 4 | Visual polish pass; hero runners seeded; report drafted |
| Project Closing | Dec 5 – Dec 10 | Final fixes and dress rehearsal; submit report Tue Dec 8; live demo Thu Dec 10 |

## Sprint 1 — Foundation + Core (Sep 22 – Oct 18)

**Goal:** data contract locked; schema + seed exist; cards render baseline chip stats.

- **Bella** — kickoff; lock the Rakha→Embun→Indra data contract; set up board + milestones
- **Rakha** — build schema; seed chip data *with per-km splits* (not just finish times)
- **Embun** — write the stat spec (exact insights + formulas); first computation pass
- **Indra** — wireframe the card sequence → static shells → wire baseline data by end
- **Harry** — sample runner content; collect/curate race photos
- **Shaun** — draft the test plan; run the Sprint 1 QA gate

**QA gate:** seed data sane; stats correct vs. seed; cards render per runner.

## Sprint 2 — Enrichment + Share (Oct 19 – Nov 13)

**Goal:** FotoYu photos + Strava opt-in layered in; share/export works.

- **Rakha** — map `fotoyu_photos` to bibs (manual mapping, no facial recognition); wire the Strava V3 API + token storage
- **Embun** — merge photos into the payload; fold in Strava HR/elevation/calories *only when present*
- **Indra** — FotoYu gallery card; "connect Strava for more" upsell state; the **share/export-as-image button** (the payoff)
- **Harry** — card microcopy; document the FotoYu simplification as deliberate
- **Shaun** — test degrade-gracefully paths (no photos / no Strava); check share output

**QA gate:** card degrades gracefully when photos/Strava absent; share output looks good.

## Sprint 3 — Polish + Hardening (Nov 14 – Dec 4)

**Goal:** visual polish; hero runners seeded; report drafted.

- **Indra** — full visual polish pass (the graded moment)
- **Rakha** — seed 3–5 **hero runners** with complete rich data for the demo
- **Embun** — edge cases: no-Strava runner, no-photos runner, empty states
- **Harry** — draft the SRS + report + documentation
- **Shaun** — full regression pass; end-to-end flow
- **Bella** — start the demo script

**QA gate:** full regression; end-to-end flow clean.

## Project Closing (Dec 5 – Dec 10)

Final bug fixes across the team. Harry finalizes the report — **submit Tue Dec 8**. Bella + Shaun dress-rehearse the demo on the hero runners. **Live demo Thu Dec 10.**

## Risk log

| Risk | Watch | Mitigation |
|---|---|---|
| Sprint 1 is front-loaded (foundation + first render together) | End of Sprint 1 | Baseline cards can slip a few days into Sprint 2 without breaking downstream work |
| Strava V3 API fights us (OAuth, tokens, rate limits) | Start of Sprint 2 | It's opt-in enrichment — if it blocks the demo, seed sample Strava metrics as a fallback; the chip baseline is what every runner sees regardless |
| Screens look done but don't talk to real data | Ongoing | PM confirms the data contract is honored at each QA gate, not just that UI renders |
| Demo on empty/thin data looks weak | Sprint 3 | Seed rich hero runners early; always demo on those |

## Definitions of done

- **A card is done** when it renders correct computed stats for a seeded runner *and* degrades gracefully when optional data (Strava/photos) is missing.
- **A sprint is done** when its goal is met *and* Shaun's QA gate passes with the bug list triaged into the next sprint.

## Workflow

Feature branches → merge to `main` via pull request → one quick review before merging. Sprints and issues live on the org Project board.
