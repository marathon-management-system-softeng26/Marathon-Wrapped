# MNC Marathon Simulation System — Requirements & Design Document

### Project Overview

A web-based marathon event registration and check-in management system that simulates the end-to-end race registration process.

Admins can create events with track details and race categories, while prospective runners register, scan a generated QRIS code as a simulated payment gateway, upload eligibility certificates and manual QRIS payment proof, and await administrative verification. Once approved, runners are assigned an "Official Runner" status and an automatic bib number and then can connect their Strava accounts to have race activities and running status tracked.

---

### Actors

| Actor | Description |
| --- | --- |
| **Admin** | Event organizer, creates events, reviews and approves payments, manages runner status |
| **Prospective Runner** | Potential runner who signs up, registers for a marathon event, uploads documents, awaits approval |
| **Official Runner** | Approved runner, has a bib, can connect Strava for race tracking, and shows up on race day |
| **System** | Background run, handles status transitions, Strava data pulls, notifications |

---

## User Flows

### Admin Flow

1. Login as admin
2. Create event and fill out the details: name, date, location, track/route detail (map/GPX or description), distance categories (5K/10K/21K/42K), quota per category, price, eligibility rules (e.g. full marathon requires proof of prior finish)
3. View dashboard of registrations: Pending Payment Review / Official / Rejected
4. Open a registration → view uploaded certificate + QRIS payment proof
5. Approve or reject:
   - **Approve** → status becomes "Official", system generates bib number
   - **Reject** → status becomes "Rejected", runner notified with reason
6. View event summary (registered, official, pending, revenue estimate)

### Runner Registration Flow

1. Sign up / login using email + phone number
2. Browse open events → select event + category
3. Fill registration form (personal info, emergency contact)
4. Upload certificate of previous marathon (required for categories with eligibility rules)
5. Make payment via QRIS (static QR shown, no live gateway yet)
6. Upload payment proof (screenshot/photo)
7. Status: "Pending Review" — waits for admin
8. Once approved: status "Official", bib number issued, notified (email)
9. Connect Strava account via OAuth for race tracking

### Runner Race Day Flow

The goal here is that the organizer knows when each runner finishes — without buying RFID chips or timing mats. Strava's V3 API + Webhook Events API make this achievable on a free tier. See section "Race Day Design" below for the full design; the flow at a glance:

1. Official runner connects Strava (OAuth2) any time before race day — the system stores their tokens + Strava athlete ID
2. On race day, runner records their run normally in the Strava app (starts at gun, stops at finish line)
3. When the runner saves/uploads the activity, Strava fires a create webhook event to our callback endpoint — this is the "finish" signal
4. System receives the webhook, fetches the activity detail, and checks it matches the event (date window + distance ≈ category distance)
5. On a match, system records the runner's finish time, distance, duration, and pace, sets a per-runner status to "Finished", and timestamps it
6. Organizer's race-day dashboard updates live — showing who has finished, their time, and who is still out on course
7. Admin can treat this as a soft/unofficial result — a low-cost proxy for chip timing, not a certified time

---

## Functional Requirements

**Accounts & Auth**

- FR1: System shall allow runners to sign up with email + phone number
- FR2: System shall allow login via email/phone + password (OTP optional, flag as future improvement if time-constrained)
- FR3: Admin shall have a separate role/login with elevated permissions

**Event Management (Admin)**

- FR4: Admin shall create/edit/delete events with name, date, location, track detail, categories, quota, price
- FR5: Admin shall define eligibility rules per category (e.g. certificate required)

**Registration (Runner)**

- FR6: Runner shall register for one category within an event
- FR7: System shall block registration once category quota is full
- FR8: Runner shall upload a certificate file (PDF/image) as proof of prior marathon completion
- FR9: Runner shall upload payment proof (image) after viewing QRIS code
- FR10: System shall set registration status to "Pending Review" after proof upload

**Payment Review (Admin)**

- FR11: Admin shall view certificate + payment proof per registration
- FR12: Admin shall approve or reject a registration with optional note
- FR13: On approval, system shall auto-generate a unique bib number and set status "Official"

**Race Tracking (Strava)**

- FR14: Official runner shall be able to connect/disconnect their Strava account via OAuth2
- FR15: System shall subscribe to Strava webhook events and receive a notification when a connected runner uploads a new activity
- FR16: On a webhook event, system shall fetch the activity detail and determine whether it matches the event (date/time window AND distance within a tolerance of the registered category distance)
- FR17: On a matched activity, system shall record the runner's finish time, distance, duration, and pace, and set their race status to "Finished"
- FR18: System shall provide the organizer a race-day dashboard showing, per event: runners finished (with time/pace), runners still active, and runners not yet started
- FR19: System shall handle the case where a runner has no Strava connection or no matching activity (status stays "No Result") without breaking the dashboard
- FR20 (fallback): Admin shall be able to manually enter/override a runner's finish time in case Strava data is missing or wrong

**Notifications**

- FR21: System shall notify runner by email on approval/rejection
- FR22: System shall notify runner by email when their finish is recorded (optional, nice-to-have)

---

## Data Model

- **users** — id, name, email, phone, password_hash, role (admin/runner)
- **events** — id, name, date, location, track_detail, created_by
- **categories** — id, event_id, distance, price, quota, requires_certificate (bool)
- **registrations** — id, user_id, category_id, status (pending/official/rejected), bib_number, created_at
- **certificates** — id, registration_id, file_url, uploaded_at
- **payment_proofs** — id, registration_id, file_url, uploaded_at, reviewed_by, review_note
- **strava_connections** — id, user_id, access_token, refresh_token, expires_at, athlete_id, connected_at
- **race_results** — id, registration_id, strava_activity_id, finish_status (no_result/finished/manual), start_time, finish_time, elapsed_time, distance, avg_pace, recorded_at, is_manual_override
- **webhook_events** — id, event_object_id (Strava activity id), athlete_id, aspect_type (create/update/delete), received_at, processed (bool) — raw log so you can debug and reprocess

---

## Race Day Design — Strava Integration (Detailed)

This is the core race-day mechanism. The design choice that makes it work on a free tier is **using webhooks instead of polling**.

### Why webhooks, not polling

- **Polling** = the system repeatedly asks Strava "any new activities?" for every runner. With hundreds of runners this burns through Strava's rate limit fast (free apps get roughly 200 requests / 15 min and 2,000 / day) and still has lag.
- **Webhooks** = Strava *pushes* a small notification to your server the instant a runner saves their activity. One event per finish, near-real-time, barely touches the rate limit. This is the right design for "know when they finish."
- Verify current rate limits and webhook behavior against Strava's official developer docs before building — the numbers above are the well-known defaults but can change.

### One-time setup (Admin / developer)

1. Register the app in the Strava developer portal → get client_id + client_secret
2. Create one webhook subscription for the app, pointing at your public callback URL (e.g. a Vercel serverless function /api/strava/webhook)
3. Strava sends a GET verification challenge to that URL once — your endpoint must echo it back to confirm the subscription

### Runner connect (OAuth2, before race day)

1. Runner clicks "Connect Strava" → redirected to Strava authorization page
2. Requests scope activity:read (enough to read their activities)
3. Strava redirects back with a code → system exchanges it for access_token + refresh_token
4. Store tokens in strava_connections; refresh the access token when expires_at passes (tokens are short-lived — the refresh token is what you keep)

### Finish detection (race day, event-driven)

1. Runner stops & saves run in Strava app
2. Strava fires webhook → POST /api/strava/webhook (aspect_type: "create") — respond 200 fast, then process async
3. Log to webhook_events
4. Look up which runner owns this athlete_id
5. GET /activities/{id} using that runner's access_token
6. Match check: activity start within event window? distance ≈ category distance (± tolerance)?
7. If match → write race_results (finish_time, elapsed_time, pace, status=finished)
8. Organizer dashboard reflects the finish (live)

### What counts as "finish time"

- Strava gives start_date and elapsed_time for an activity.
- **Finish time** = start_date + elapsed_time. Use elapsed_time (wall-clock) rather than moving_time so pauses at water stations still count — closer to a real race clock.
- Store both start and finish so the dashboard can show elapsed duration per runner.

### Important realism caveats (state these in your report)

- The "finish" signal depends on the runner saving their activity — a runner who forgets to hit save won't register a finish until they do. This is why FR20 (manual admin override) exists as a fallback.
- Strava webhooks are near-real-time but not instantaneous like a physical timing mat — acceptable for a simulation, not for certified results.
- Distance won't match the course exactly (GPS drift, extra walking) — use a tolerance (e.g. ±1–2 km) rather than an exact match.
- Handle update and delete webhook aspect types gracefully (a runner can edit/delete an activity after uploading).

---

## Non-Functional Requirements

- **NFR1 (Budget):** All third-party services used must have a workable free tier (no paid infra required to run the simulation)
- **NFR2 (Security):** Certificate and payment proof files shall be stored privately, not publicly listable; accessible only to the uploader and admins
- **NFR3 (Data integrity):** Once a registration is approved and a bib is issued, the bib number shall not change
- **NFR4 (Usability):** Registration flow (upload certificate → upload payment proof) completable in under 5 steps
- **NFR5 (Auditability):** Every approve/reject action shall be logged with admin id + timestamp

---

## Recommended Tech Stack (Low-Budget & Practical)

| Layer | Recommendation | Why |
| --- | --- | --- |
| Frontend | Next.js + Tailwind | Fast to build, works well with Claude Code, free hosting on Vercel |
| Backend | Next.js API routes | No separate backend service needed |
| Database | Supabase (Postgres) | Generous free tier, built-in auth + storage |
| Auth | Supabase Auth (email/phone) | Avoids building auth from scratch |
| File storage | Supabase Storage | Private buckets for certificates/payment proof |
| Strava integration | Strava V3 API (OAuth2) + Webhook Events API | Free tier; webhook callback runs as a Vercel serverless function — no extra infra |
| Hosting | Vercel (free tier) | Pairs naturally with Next.js |
| Email notifications | Resend or Supabase built-in email | Free tier sufficient for small event scale |
| QRIS | Static QR image (manual, no gateway) | Zero-cost placeholder until payment gateway is added |

---

## Out of Scope / Future Improvements

- Real payment gateway integration (Midtrans/Xendit) to replace manual QRIS review
- Official RFID/chip timing at physical checkpoints
- OTP-based phone verification (nice-to-have, not required for v1)
- Push notifications (email is sufficient for v1)
- Multi-organization / multi-tenant support
- Strict Strava route-matching against the official GPX track (v1 matches on date window + distance tolerance only)
- Live leaderboard ranking of finishers by category (v1 shows finish times; ranking/sorting is a small add-on)
- Auto-refreshing Strava tokens as a scheduled job vs. refresh-on-demand

---

## Open Questions / Assumptions (please confirm or adjust)

1. **Certificate file types:** assumed PDF or image — confirm if you want to restrict to one.
2. **"Gate"** in the project name — assumed to mean the registration/approval gate (who gets to become an official runner), not a physical race-day QR scan gate. If a physical check-in/gate scan on race day is also wanted, that's a separate flow worth adding.
3. **Phone number use:** assumed profile field only for v1, not OTP-verified — flag if OTP is required.
4. **Strava matching logic:** v1 matches an activity on date/time window + distance tolerance, not exact route. Confirm the distance tolerance wanted (e.g. ±1 km) and the event time window (e.g. activity must start within race start ± a few hours).
5. **Public callback URL:** the Strava webhook needs a publicly reachable HTTPS endpoint — this is why hosting on Vercel (or similar) matters even during development. Local-only builds will need a tunnel (e.g. ngrok) to test webhooks.
6. **"Finished" without Strava:** confirm the manual admin override (FR20) is acceptable as the fallback for runners who don't use Strava, rather than requiring every runner to connect it.

---

*Source: MASTER | Software Engineering Group B (Google Doc), SRS & User Flow tab.*
