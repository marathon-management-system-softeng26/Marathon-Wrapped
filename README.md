# Marathon Wrapped 🏃‍♀️✨

A Spotify-Wrapped-style web app that turns each runner's marathon into a personal, shareable recap. Every runner gets baseline stats from the **timing chip on their bib**; those who want more can **opt in to Strava** for health metrics, and race photos are pulled in through a simulated **FotoYu-style photo marketplace**. 

The demo is meant for Soekarno Run 2027. Soekarno Run is a series of annual running events held in Indonesia that combine sport, community culture, and the commemorative spirit of Indonesia's first president.

> **Prototype for Sampoerna University x University of Arizona - Software Engineering course**, not production grade.Chip data is seeded, FotoYu is simulated (photos manually mapped to bibs, no facial recognition), and Strava is real-free-API.
> **Deliverable: working prototype + live demo + documentation report**

## What it does

- **Your Wrapped** — finish time, average pace, and where you ranked in your category
- **Split story** — fastest km, negative vs. positive split, where you slowed
- **Shareable insights** — punchy stat lines like *"you passed 43 people in the last 5K"*
- **Strava add-on (opt-in)** — heart rate, elevation, calories, cadence
- **FotoYu gallery** — race photos matched to your bib
- **Share as image** — export a screenshot-ready card for social

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js + Tailwind CSS |
| Backend | Next.js API routes |
| Database | Supabase (Postgres) |
| Photo storage | Supabase Storage |
| Enrichment | Strava V3 API |
| Hosting | Vercel|

## Structure

```
marathon-wrapped/
├── ROADMAP.md   → sprint plan and user roles
├── /app         → UI for Wrapped cards and gallery
├── /lib         → logic for stats, ranking, merging      
├── /db          → database schema and seed scripts              
├── /public      → sample photos and public assets          
├── /docs        → SRS and documentation reports       
└── /tests       → test plan and QA notes               
```

## Getting started

```bash
npm install
cp .env.example .env.local   # then add your Supabase keys
npm run dev
```

Open http://localhost:3000. You'll need a free Supabase project — seed scripts are in `/db`.

## Team

| Member | Role |
|---|---|
| Bella | PM — requirements, scope, planning & demos |
| Rakha | Database — schema, seed, hero runners |
| Embun | Logic — Wrapped computation and merging |
| Indra | UI/UX — the Wrapped card experience |
| Harry | Content and docs — sample data, reports |
| Shaun | QA — per-sprint testing and edge cases |

## Workflow

Work on feature branches, merge to `main` via pull request, one quick review before merging. Sprints and issues live on the org Project board — see `ROADMAP.md`.

## Timeline

3 sprints (3, 4 and 3 weeks), ending with demo week, **Sep 28 – Dec 4, 2026**. Full breakdown in `ROADMAP.md`.
