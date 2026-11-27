# Wrapped Stats Recovery Design

## Goal

Make the official ScoreNow-backed result the stable source for a runner's Wrapped. A claimed runner must see the persisted result, every published checkpoint/split, rankings, timing, and selected personal photos without connecting Strava. Strava remains optional enrichment and its connection action lives outside the Wrapped story.

## Current evidence

- `app/components/RecapStory.tsx` fetches the Wrapped payload only after the client mounts with `cache: "no-store"`, so opening the route always starts in a loading state.
- `app/api/runners/[runnerId]/wrapped/route.ts` is `force-dynamic` and returns `Cache-Control: private, no-store`; the route has no stable server-rendered payload or client cache seed.
- The API already chooses `getOfficialWrappedForUser` before the Strava service and then merges selected private photos.
- `getOfficialWrappedForUser` reads `official_race_results` and `official_race_checkpoints`, which are the published ScoreNow-backed source of truth.
- The current chart fallback turns official checkpoint rows into synthetic kilometer numbers (`index + 1`), losing the ScoreNow checkpoint labels/distances and making the displayed split data misleading.
- The current story renders `StravaCard` inside the Wrapped context slide and renders Strava setup as a full-page state for Strava-first payloads, even though official results are available without Strava.
- Live Supabase inspection on 2026-11-27 found 9,984 official results, 18,738 checkpoints, four ready/included uploaded photos, and three included photos for the linked runner with BIB `14420`.

## Desired behavior

1. `/wrapped/[runnerId]` is server-seeded from the authenticated official Wrapped payload whenever an official result exists.
2. The first paint contains the stable official stats and photo list; a client refresh is used only for explicit refreshes or changing Strava workflow state.
3. Official checkpoint rows are preserved in sequence with their source label, distance, displayed elapsed time, and reported split time. The UI shows all rows returned by ScoreNow; it never invents kilometer numbers for official checkpoints.
4. The Wrapped story always works when Strava is disconnected. The context scene explains that Strava is optional and links to the separate Strava setup route, but does not contain the connect button/card.
5. Dashboard/race-pass and `/runners/[runnerId]/strava` remain the locations for connecting, attaching, confirming, and disconnecting Strava.
6. Included ready personal photos are loaded by runner and registration, merged before organizer photos, and shown in the photo scene. A failed optional photo read must be visible as a recoverable notice rather than silently making a successful upload look absent.
7. The PNG export uses the same official timing and complete official checkpoint list as the on-screen recap, subject to the export canvas's documented layout limit.

## Non-goals

- Do not make Strava required for a Wrapped.
- Do not expose private photo storage URLs, Strava identifiers, health metrics, or registration fields.
- Do not fabricate per-kilometer data when ScoreNow only publishes checkpoint data.
- Do not redesign the ScoreNow publication pipeline or alter official result rows.

## Acceptance examples

- A runner with an official result and no Strava sees a complete Wrapped with no interstitial Strava setup page.
- A runner with three ready/included uploaded photos sees all three in Wrapped after navigating away and returning.
- A 10K result with three published ScoreNow checkpoints displays all three labels and both elapsed/split values where present.
- Reopening the same Wrapped does not show a blank loading state before the server-seeded payload appears.
- A Strava connect action is available from the dashboard/Strava route, not as a button inside the Wrapped story.
