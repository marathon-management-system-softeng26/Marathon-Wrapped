# Marathon Wrapped

Web prototype for Soekarno Run 2027 participants to understand their chip result, explore splits and matched photos, and save a race memory. Organizers manage synthetic hero runners and results for the presentation.

Authority: `docs/SRS_v4.md`, `docs/requirements-register.md`, and the approved integration design. Data ownership is enforced by verified Supabase sessions and server-owned mappings. Chip data remains the baseline; enrichment can fail independently. Never infer hydration, invent missing timing, or describe demo metrics as a live connection.

Decision history: on October 20, 2026, no Strava application existed, so the approved deliverable was a clear disconnected state. On November 2, 2026, the direction changed to a complete opt-in integration on the isolated `integration` branch because runner-bound OAuth, activity selection, safe metrics, fallback, and disconnection are required by FR-08–FR-11. Automated and local PostgreSQL evidence exists; real-provider, dedicated remote database, and manual browser acceptance remain pending until separately supplied test credentials and authorization are available. The local Figma Make export under the primary checkout's `ui reference` directory is read-only visual reference and must not be committed. Synthetic fixtures and stock photo mappings must be labeled as demonstrations.

Success: sign in, find the authorized runner, understand finish/DNF/DNS/missing results, inspect photos and export a correct 1080 × 1350 PNG. Organizers can create/update hero runners within their event. No public personal recap links.
