# Marathon Wrapped

Web prototype for Soekarno Run 2027 participants to understand their chip result, explore splits and matched photos, and save a race memory. Organizers manage synthetic hero runners and results for the presentation.

Authority: docs/SRS_v3.md, requirements-register.md and the approved core-first design. Data ownership is enforced by verified Supabase sessions and server-owned mappings. Chip data remains the baseline; enrichment can fail independently. Never infer hydration, invent missing timing, or describe demo metrics as a live connection.

User decision, October 20: no Strava application exists; deliver a clear disconnected state. Real OAuth acceptance remains deferred. The local Figma Make export under the primary checkout's `ui reference` directory is read-only visual reference and must not be committed. Synthetic fixtures and stock photo mappings must be labeled as demonstrations.

Success: sign in, find the authorized runner, understand finish/DNF/DNS/missing results, inspect photos and export a correct 1080 × 1350 PNG. Organizers can create/update hero runners within their event. No public personal recap links.
