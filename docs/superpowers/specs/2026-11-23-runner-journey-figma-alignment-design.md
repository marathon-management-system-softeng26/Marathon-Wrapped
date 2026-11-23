# Runner Journey Figma Alignment

## Intent

Bring the deployed Marathon Wrapped runner experience into the visual world already established in the `Copy design from Figma` Figma Make project, while preserving the real Supabase authentication, runner ownership, Strava workflow, and dynamic Wrapped data.

The runner should experience one coherent product from sign-in through sharing a recap. The current Figma login, registration, and seven-card Wrapped story are the visual authority. Screens that do not exist in Figma yet will be designed as natural extensions of that system rather than as generic dashboard UI.

## Goals

- Finish the complete runner-facing journey: login, registration, confirmation feedback, runner menu, claim flow, Strava connection and selection states, Wrapped story, and share/export.
- Match the Figma Make direction: race photography, strong red/cream/lime color blocking, bold Bricolage typography, flat graphic stickers, and mobile-first story composition.
- Preserve real application behavior and dynamic runner, race, activity, and photo data.
- Make every runner screen responsive and usable on mobile and desktop.
- Keep accessibility intact: semantic forms, visible focus, keyboard navigation, readable contrast, reduced-motion support, and useful loading/error states.
- Establish reusable visual primitives so a later organizer redesign uses the same brand without copying page-specific CSS.

## Non-goals

- Replacing Supabase Auth, claim codes, Strava OAuth, or the job-processing architecture.
- Copying Figma Make's mock authentication, hard-coded runner name, or static sample statistics.
- Changing database contracts or product workflow unless a UI defect reveals a necessary compatibility fix.
- Fully redesigning organizer workflows in the first implementation pass. A compact admin pass follows only after the runner journey is working and verified.
- Recreating the Figma phone-device chrome in the web application.

## Anti-goals

- A screenshot-based or flattened implementation.
- A generic collection of rounded SaaS cards that loses the event identity.
- Desktop layouts that merely stretch the narrow mobile composition.
- Visual fidelity that breaks authentication, privacy boundaries, dynamic content, or error recovery.
- A large unstructured CSS appendix with another layer of overrides.

## Chosen approach

### Runner-first, then admin

Implement and verify the complete runner path first. Reuse the Figma visuals while translating them into the existing Next.js components and real state machines. After the runner flow passes, apply the resulting tokens and primitives to the organizer shell and its highest-traffic panels if time allows.

This was selected over:

- **One large runner-and-admin redesign:** maximizes simultaneous consistency but delays the runner journey and makes visual regression review too broad.
- **Direct Figma Make code transplant:** visually fast, but its mock navigation, static values, and component structure conflict with the production Supabase and Strava behavior.

## Visual system

### Color

- Race red: `#a61729` for primary fields, actions, and story backgrounds.
- Deep red: `#7a051d` for depth, pressed states, and dark story gradients.
- Cream: `#fff6ec` for readable surfaces and light text on red.
- Lime: `#c8f02e` for one high-energy emphasis per scene.
- Field: `#fffaf4` with muted red-gray borders for form controls.
- Muted rose and clay surfaces remain secondary and never compete with lime.

Existing CSS variables remain the source of truth. Missing semantic variables will be added once and reused.

### Type

- Bricolage is the product typeface for display, headings, statistics, labels, and controls.
- Arial/Helvetica remains a conservative fallback only.
- Headlines use tight leading and tracking, with line breaks composed for meaning rather than viewport accidents.
- Small labels use sentence case unless the Figma artwork itself contains fixed uppercase lettering.

### Composition

- Mobile is an immersive edge-to-edge race story.
- Desktop uses a deliberate two-zone or centered-stage composition, maintaining readable measure rather than simply enlarging mobile controls.
- Photography and stickers may bleed and crop, but interactive content remains in a stable safe area.
- Rounded corners indicate controls and contained surfaces; they are not applied indiscriminately to every section.
- Motion is limited to story transitions, progress, and feedback that explains state changes.

## Runner journey

### 1. Login

- Preserve the Figma split: start-line photograph and event wordmark above/alongside the form.
- Keep real email/password sign-in and Google OAuth.
- Present errors directly below the relevant form region without shifting the main action out of reach.
- Keep registration navigation explicit.
- Password recovery remains visibly unavailable unless the backend is configured; it must not look like an active dead-end link.

### 2. Registration

- Use the same race-image masthead and a cream registration panel.
- Preserve the actual registration and email-confirmation behavior on `dev`, including any BIB/profile steps already added after the original Figma mockup.
- Use a neutral confirmation treatment for both new and potentially existing accounts, matching the API's deliberate account-enumeration protection, with a clear route back to sign-in.
- Keep Google sign-in on the login screen and connected to the real callback. Registration continues through the existing email/BIB-first flow rather than introducing a second Google-specific linking path.
- Include the signed-in BIB-linking variant and `/profile` in this runner-facing visual pass.

### 3. Runner home/menu

This is the primary missing Figma screen. It becomes a race-day dashboard rather than a generic account page.

- Lead with the signed-in runner's next useful action.
- Show each claimed registration as a reusable race-pass component: event, category, BIB, runner name, current Strava state, and one primary action.
- Place claim-code redemption in a secondary expandable section so new runners can claim a race without overwhelming returning runners. Expand it automatically when the account has no races or a valid emailed claim token has been handed off; claiming remains an explicit submit and the token remains scrubbed from browser history.
- Organizer access, when present, appears as a quiet secondary destination.
- Empty state clearly directs the runner to claim a registration.

### 4. Strava setup and activity selection

- Retain the existing state machine and API behavior.
- Translate `setup_required`, `attachable`, `authorizing`, `importing`, `needs_confirmation`, `no_match`, `building`, `failed`, `disconnecting`, `reauth_required`, `reauthorize_to_disconnect`, and `ready` into branded, distinct screens where those states apply.
- Use a route/map-inspired progress treatment and plain-language explanations.
- Activity candidates use reusable selection cards showing the already-allowlisted date/time, distance, and match reason. Duration is not added to the candidate contract for this visual pass.
- Destructive disconnect/detach actions remain visually secondary and require the existing explicit interaction.
- Polling and recovery remain functional; decoration must never obscure status changes.

### 5. Wrapped story

- Retain seven dynamic slides and the existing progress/navigation behavior.
- Match the Figma scenes already created: greeting, finisher, distance, splits, race context/hydration treatment where data permits, photos, and share.
- Dynamic names and values replace all Figma placeholders.
- A verified official BIB result unlocks the Wrapped story and 1080 x 1350 PNG without waiting for Strava. Official data is authoritative for finish status, official elapsed time, event distance, and official splits. Strava may enrich the story with selected-activity metrics such as cadence, elevation, heart rate, and compatible split context, but it does not override the official finish status.
- DNF and DNS receive explicit result-aware story variants and never inherit finisher language or fabricated completion statistics.
- The race-context slide uses only measured data available in the production contracts. Hydration claims from the Make mockup are excluded because the application has no hydration source.
- Each slide has a meaningful empty/fallback composition when optional metrics or photos are absent.
- Maintain keyboard, button, swipe, and reduced-motion behavior.
- Exported 1080 x 1350 output must visually match the on-screen share card and use local assets. Sharing remains PNG download/export; the Make mockup's Copy Link action is not introduced.

### 6. Completion and return paths

- Sharing or saving does not strand the runner; provide a clear return to races.
- Authentication expiry returns to login while preserving only safe, non-secret navigation intent.
- Strava failures provide a retry or reauthorization action appropriate to the state.

## Reusable UI boundaries

The implementation should extract or stabilize these visual pieces instead of duplicating markup:

- `AuthMasthead`
- `AuthPanel`
- `RacePassCard`
- `RunnerJourneyState`
- `ActivityCandidateCard`
- `StoryProgress`
- `StoryControls`
- shared feedback/empty-state treatment

Names may follow existing repository conventions, but the boundaries should remain recognizable.

## Assets

- Reuse existing repository photos, logos, and `public/decorations/funky` assets first.
- Figma assets are visual references or discrete source assets, never complete-screen screenshots.
- Use the canonical Figma Make project already inspected and the checked-out local export at `D:/!! GITHUB CLEAN/Marathon-Wrapped/ui reference` as implementation references; do not copy its mock data or behavior.
- Any new asset transferred from Figma must be stored locally with provenance and used at its intended geometry.
- Do not introduce remote temporary Figma URLs.

## Data and security constraints

- All runner data continues to come through authenticated APIs and server-owned access mappings.
- No runner identity, activity, candidate, or photo data is made public to simplify the design.
- Claim tokens remain explicitly consumed and must not persist in URLs.
- UI refactoring must preserve same-origin checks, private cache headers, and access-denied handling.

## Responsive behavior

- Validate at approximately 390 px mobile, 768 px tablet, and 1280–1440 px desktop widths.
- Forms remain one column; on desktop the masthead and panel may sit side by side.
- Runner cards use one column on mobile and a restrained grid on wide screens.
- Wrapped story content uses a centered stage with controlled maximum dimensions and safe-area-aware controls.
- No horizontal scrolling except within intentionally scrollable media strips.

## Admin follow-up

After the runner flow passes verification, apply the same header, typography, controls, feedback states, and surface tokens to the organizer shell. Preserve the information-dense results, runner-access, enrichment, and Strava configuration workflows. The admin interface should feel related to the runner product but prioritize scanning and editing over immersive storytelling.

The admin pass may be deferred if runner verification exposes functional work; it must not block shipping the runner journey.

## Verification

- Unit/API tests for affected behavior continue to pass.
- TypeScript, lint, and production build pass.
- Browser verification covers login, registration/confirmation, signed-in BIB linking and profile, mailed claim handoff, claim/menu, every Strava state that fixtures can exercise, official-only Wrapped including DNF/DNS, enriched Wrapped, all seven story slides, export, keyboard focus, and mobile/desktop layouts.
- Visual comparison uses the Figma Make preview as the target for screens it defines.
- Missing-screen designs are reviewed for consistency with the same tokens, typography, artwork, and interaction vocabulary.
- Existing privacy and authorization tests remain unchanged unless the product contract explicitly requires a change.
- Before pushing, run deterministic browser acceptance against the repository's authenticated fixtures or dedicated non-production Supabase environment. Real-provider Strava acceptance remains a separate final smoke check when credentials and a private test athlete are available.

## Implementation handoff

Implementation should start from the current `dev` branch, which already contains the earlier Figma login/recap work and newer Google OAuth/BIB/profile behavior. It should refine that work rather than transplant the older Figma Make prototype wholesale. Work will be committed and pushed to `origin/dev` only after verification.
