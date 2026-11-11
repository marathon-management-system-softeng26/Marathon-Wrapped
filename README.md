# Marathon Wrapped

Marathon Wrapped gives Soekarno Run 2027 runners a private race showcase based on a selected Strava activity. Runners sign up, confirm their email, and claim a registration with a one-time code from the event organizer. Each claimed runner card offers a Strava action. Once the worker stores a ready showcase, the runner can view it and save a 1080 × 1350 PNG. The trusted registration supplies the event, category, BIB, and any matching photos from the simulated FotoYu gallery.

This is a Sampoerna University × University of Arizona Software Engineering course prototype. The November 11, 2026 decision supersedes chip-first Wrapped generation. Seeded chip results remain available to organizers for legacy event operations. The [product contract](PRODUCT.md) and [SRS](docs/SRS_v4.md) describe the approved workflow.

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js + Tailwind CSS |
| Backend | Next.js API routes |
| Database | Supabase (Postgres) |
| Photo storage | Supabase Storage |
| Activity source | Strava V3 API |
| Hosting | Vercel|

## Structure

```
marathon-wrapped/
├── ROADMAP.md   → sprint plan and user roles
├── /app         → UI for Wrapped cards and gallery
├── /lib         → activity projection and application logic
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

The ignored `.env.demo.local` holds synthetic demo account credentials and live-test settings for scripts. Next.js does not load it automatically.

### Database and email setup

Apply migrations in filename order to a local or dedicated non-production Supabase database. The approved plan records that the dedicated project `anbnuegocddoowagqmxw` stops at `20261020020029_organizer_optional_aggregate`. Verify the target and its migration history before applying these six outstanding migrations.

1. `20261026175630_strava_integration.sql`
2. `20261028192351_strava_lifecycle.sql`
3. `20261101000100_strava_race_matching.sql`
4. `20261101000200_strava_worker_matching.sql`
5. `20261102074802_strava_atomic_confirmation.sql`
6. `20261102192931_strava_runner_scope_privacy.sql`

Then apply the plan's two new migrations in order, `strava_first_runner_claims` and `strava_runner_attachments_and_snapshots`. The Supabase CLI assigns their version prefixes when those migrations are created. Check for duplicate direct owners before adding the one-owner constraint, then verify migration history, functions, constraints, grants, RLS, and database advisors.

Enable email confirmation in Supabase Auth. Set the Site URL to the application URL, allowlist the intended confirmation redirect URLs for the environments in use, and configure SMTP for confirmation delivery. Verify that a new user can receive the email, confirm, and sign in.

### Organizer sign-in

1. Create an account in the app and confirm its email.
2. On a trusted machine, set `SUPABASE_DEMO_PROJECT_REF` in ignored `.env.local` to match the dedicated `SUPABASE_URL` (`https://<project-ref>.supabase.co`). Use that project's server-only `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`. Run the grant with the confirmed email and the numeric `events.id`.

   ```sh
   npm run grant:organizer -- --email <email> --event-id <id>
   ```

3. Sign in with the confirmed account. Check that `GET /api/session` includes the granted event in `events`, then open **Manage event results** on the home page. It opens `/organizer`, whose API checks the account's event access on the server before returning organizer data or accepting changes.

### Strava configuration

Set these server-only environment variables.

| Variable | Value |
|---|---|
| `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` | Strava application credentials |
| `STRAVA_CALLBACK_URL` | Exact public HTTPS URL ending in `/api/strava/callback` (HTTP localhost allowed in development) |
| `STRAVA_ENCRYPTION_KEY` | 32 random bytes encoded as 64 hexadecimal characters. Keep it stable and outside the database. Migrate existing encrypted tokens before rotating it. |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | Random secret used when registering the webhook |
| `STRAVA_SUBSCRIPTION_ID` | Subscription ID returned by Strava |
| `STRAVA_PROCESS_SECRET` | Random bearer secret for the job-processing endpoint |

Each athlete authorizes their own account through OAuth with `activity:read_all` so the runner can select an activity visible only to them. The server stores encrypted access and refresh tokens. The dashboard token `STRAVA_ACCESS_TOKEN` has no role in this flow.

- Register the public `/api/strava/webhook` endpoint with Strava, verify its subscription challenge, and store the returned subscription ID. Webhooks queue refreshes for attached registrations.
- Schedule periodic POST requests to `/api/internal/strava/process` with `Authorization: Bearer <STRAVA_PROCESS_SECRET>` on hosting that permits the 60-second handler. The worker handles bounded race imports, snapshot builds, and durable revocation retries. Jobs stop after eight failed attempts. Inspect failed jobs through trusted backend tooling.
- Configure each participating category's race window, allowed `Run` type, distance tolerance, and optional start-location constraint. A sole fully qualifying activity with a passing location check may auto-select. Otherwise the runner confirms a candidate or retries when an eligible activity becomes available.
- Begin real-provider acceptance with a private test athlete and activity on the dedicated project. Record the approved athlete capacity and API rate limits. Keep access private until acceptance passes and capacity covers the broader demo. Complete Strava app-access review before expanding beyond the approved athlete count.

The dashboard and showcase read stored state while the worker handles provider requests. **Use Strava for this race** attaches a claimed registration to the account's existing athlete connection. Detach removes only that registration's Strava data. Account disconnect removes all live snapshots and queues remote revocation if cleanup needs a retry.

Open [the local app](http://localhost:3000) after starting the development server. For verification, run `npm test`, `npm run test:native`, `npm run lint`, `npx tsc --noEmit`, and `npm run build`. Use the [acceptance matrix](docs/qa/acceptance-matrix.md) and the [November 11 plan](docs/superpowers/plans/2026-11-11-strava-first-runner-claims.md) for dedicated-database, browser, and real-provider checks.

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
