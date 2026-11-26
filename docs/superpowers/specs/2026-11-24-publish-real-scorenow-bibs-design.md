# Publish Real ScoreNow BIBs — Design

## Intent

Make every validated ScoreNow result already imported for Soekarno Run available to the existing BIB registration flow. Registration continues to trust only `official_race_results`; raw staging data never becomes a public lookup surface.

## Current state

- `scorenow_results` contains 9,982 validated rows: 3,995 10K and 5,987 5K.
- Event edition `1` is the application event and is configured for BIB signup.
- `official_race_results` contains only two claimed `HERO-*` mock records, so real BIBs are not discoverable.
- The newer `scorenow_import_*` tables and `publish_scorenow_import` RPC already enforce completeness, duplicate identity, source provenance, and atomic publication, but the original imported rows predate that staging model.

## Chosen approach

Add a bounded publication script that reads the existing validated `scorenow_results` rows in deterministic batches, converts them into the newer reviewed staging contract, and invokes the existing atomic publication RPC.

The script will:

1. Refuse any project other than the dedicated `anbnuegocddoowagqmxw` project.
2. Require event `1` to match ScoreNow competition `19723` and race `308`.
3. Read all imported rows, verify the expected 5K/10K totals, unique BIBs/source identifiers, status/timing consistency, and stable provenance.
4. Create one logical staging page per distance because the legacy import retained source URLs and source UIDs but not original page-row coordinates.
5. Preserve names, BIBs, ranks, gender/division, source URL, result status, official time, and safely normalized checkpoint splits.
6. Stage in batches of at most 100 rows, mark the legacy-to-reviewed identity transition explicitly reviewed, and call `publish_scorenow_import` once.
7. Leave the two claimed `HERO-*` demo registrations intact; publishing real results must not delete existing ownership.
8. Verify row counts, a real sample lookup such as BIB `14279`, and registration availability after publication.

## Alternatives considered

- **Direct registration lookup against `scorenow_results`: rejected.** It bypasses the reviewed publication and identity boundary.
- **Publish selected examples only: rejected.** It would leave most real participants unable to register.
- **Re-scrape ScoreNow before publishing: deferred.** The current validated database import is complete and stable; re-scraping would introduce a new external-data revision rather than publish the reviewed dataset already in scope.

## Safety and rollback

- Tests cover transformation, status mapping, checkpoint normalization, batching, and refusal conditions before any remote write.
- The publication RPC is transactional; a failed validation publishes nothing.
- The import run and `published_run_id` provide an audit trail. A later corrected ScoreNow run can supersede this publication through the same reviewed pipeline.
- No authentication accounts are created and no BIB ownership is assigned during publication.

## Acceptance

- `official_race_results` contains all 9,982 real ScoreNow rows plus the existing demo rows.
- Real BIB `14279` resolves under event edition `1` through the same registration lookup used by the UI.
- Existing claimed registrations and organizer access remain intact.
- Unit, SQL/native, lint, type, and production-build checks pass.
