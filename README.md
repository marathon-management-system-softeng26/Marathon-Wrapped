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
npm run dev
```

Before starting, configure the ignored `.env.local` with `SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and the server-only `SUPABASE_SERVICE_ROLE_KEY`. Demo seeding also uses `SUPABASE_DEMO_PROJECT_REF`. Never commit environment files or share secret values.

The ignored `.env.demo.local` holds synthetic demo account credentials and live-test settings. It is used by the demo/test scripts, not loaded automatically by Next.js. Strava credentials are not configured; the demo shows a disconnected state.

### Strava backend

The backend supports OAuth, encrypted rotating tokens, webhook ingestion, resumable imports, and disconnect cleanup. Race matching and the connection UI are still deferred; recap enrichment remains unchanged.

Apply `supabase/migrations/20261028192351_strava_lifecycle.sql` after the original Strava migration, first in a local or dedicated test database. Legacy connections must reconnect because the old schema did not record athlete identity or granted scopes. This migration clears those old token values. No remote migration is applied automatically.

Configure these server-only variables:

| Variable | Value |
|---|---|
| `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` | Strava application credentials |
| `STRAVA_CALLBACK_URL` | Exact public HTTPS URL ending in `/api/strava/callback` (HTTP localhost allowed in development) |
| `STRAVA_ENCRYPTION_KEY` | 32 random bytes encoded as 64 hexadecimal characters; keep stable and outside the database |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | Random secret used when registering the webhook |
| `STRAVA_SUBSCRIPTION_ID` | The subscription ID returned by Strava |
| `STRAVA_PROCESS_SECRET` | Random bearer secret for the job-processing endpoint |

`STRAVA_ACCESS_TOKEN` from the Strava dashboard is not used as a shared fallback. Each user's access and refresh tokens come from their own OAuth authorization and are stored encrypted.

- Start authorization with a same-origin `POST /api/strava/connect`, preferably a normal form submission so the browser follows the redirect. GET does not start authorization. The callback requires the same app account and browser.
- Cancel this browser's pending authorization with same-origin `DELETE /api/strava/connect`. Closing the provider tab has no guaranteed callback; unused attempts expire after ten minutes. Cancellation cannot undo a connection that already committed; use disconnect instead.
- Disconnect with same-origin `POST /api/strava/disconnect`. A `202` means local ingestion is disabled but remote cleanup is unfinished. `reauthorize_to_disconnect` means a refresh response may have been lost: POST connect again, authorize the same athlete, and the recovered credentials will be queued for revocation, not reactivation.
- Register `/api/strava/webhook` as the public webhook callback. POST payloads are not signed; workers verify provider state before destructive changes.
- Configure an external scheduler to POST `/api/internal/strava/process` with `Authorization: Bearer <STRAVA_PROCESS_SECRET>`, on hosting that permits a 60-second handler. Work is leased, retried, and stops after eight failed attempts. Inspect failed jobs through trusted backend/database tooling. No scheduler or provider subscription is installed automatically.
- Historical import requires explicit UTC race-window bounds. The backend-only `enqueueStravaBackfill(userId, after, before)` takes Unix seconds from owned race configuration. No recent-history import runs automatically while that configuration is absent. Activity details are stored privately for later matching; runner confirmation currently returns `501`.

OAuth exchange/refresh and database persistence cannot be one transaction. Lost refresh credentials require reauthorization rather than unsafe retries. If authorization-code exchange succeeds remotely but its response is lost, restart authorization; any abandoned provider-side grant may also need removal in Strava's application settings. Never rotate the encryption key without migrating existing encrypted tokens.

Verification: `npm test`, `npm run build`, and `npm run test:native`. The isolated PostgreSQL lifecycle check runs when `STRAVA_PGLITE_MODULE` points to an externally installed PGlite entry module (`dist/index.js`); it adds no application dependency. True concurrent RPC tests are opt-in with `RUN_STRAVA_DATABASE_TESTS=1` and the existing dedicated-project test environment, then `npm run test:db`. Do not point integration tests at production.

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

3 sprints (4, 4 and 3 weeks) plus Project Closing (Dec 5 – Dec 10), **Sep 22 – Dec 10, 2026**. Full breakdown in `ROADMAP.md`.
