# Marathon Wrapped documentation conventions

Apply these conventions to future project documentation and revisions. They implement Bella’s request to follow the lecturer examples across the project. Historical snapshots remain historical; do not silently rewrite their scope or version labels.

Source: [October 1 lecture notes](lecture-notes/2026-10-01-requirements-engineering.md). Current specification: [SRS V3](SRS_v3.md).

## Readers and writing

State the intended audience, owner, revision date, version, purpose and change summary. Explain the user need before implementation detail. Keep user requirements readable without technical expertise; separate precise system requirements. Define technical terms in a glossary and do not assume readers know them.

Use **shall** for mandatory requirements and **should** for desirable requirements. Apply this deliberately: an optional user choice may still require mandatory application support. Keep one independently checkable obligation per clause. Highlight the obligation and important threshold. Each requirement needs an ID, rationale and verification measure.

## Stable IDs and module grouping

Retain established `UR-F`, `UR-NF`, `SR-F` and `SR-NF` IDs. Use `UR-D` and `SR-D` for V3 desirable recommendations. Do not reuse retired IDs or renumber existing requirements because their order changes. Lettered child clauses keep the parent reference when a bundled requirement is split. A new ID records a genuinely new obligation.

Use a **module column** rather than renaming existing IDs:

| Module | Typical scope |
| --- | --- |
| Results | Runner selection, timing, rankings, splits, DNF |
| Strava | Consent, metrics, failure fallback, disconnect |
| Photos | BIB matching, gallery, no-photo outcome |
| Recap and export | Assembly, runner isolation, image generation and errors |
| Organizer | Event results and demonstration-runner management |
| Shared quality | Loading time, resilience, privacy, compatibility, cost, data integrity |

Link each user need to system requirements, function forms, relevant diagrams, implementation issues and planned/actual tests. Keep planned tests separate from evidence of execution. [Requirement register](requirements-register.md).

## Structured function forms

Use definition/description, inputs, input sources, outputs, destinations, required information, actions, preconditions, postconditions, side effects and exceptions. Fill a field with “none” or a labeled open decision rather than leaving an unexplained blank. Include linked requirement IDs.

## Diagram conventions

- **Flowchart:** a human-readable journey with named decisions and branches, including missing-data and failure outcomes.
- **Use case:** actor goals inside the application boundary; external actors outside it. Associations express participation, not order. Use include/extend only when they accurately represent required/reusable or conditional behavior.
- **UML activity:** action sequence, guarded branches, merge, start/end and explicit responsibilities. Do not misuse a fork as an either/or choice.
- **UML class:** concepts, attributes and accurate association multiplicities. Label conceptual models separately from physical schemas. A derived recap is not automatically a new database table.
- **Sequence, when needed:** ordered interactions for a concrete scenario; alternative success/failure paths; no invented external services.
- **Architecture:** distribute responsibilities across modules and distinguish existing/reused services from project-specific logic. Label anticipated design separately from verified implementation.

Give every diagram a purpose, accessible description, requirements references and editable source. Read the rendered result: no overlapping labels, unlabeled decisions, misleading arrows or invented data.

## Approved visual identity

| Role | Color |
| --- | --- |
| Primary/event red | `#BA3143` |
| Canvas/panel cream | `#FAF6EB` |
| Decision/optional emphasis lime | `#D8F24B` |
| Text/deep neutral | `#291B1D` |

Use cream text on red, dark text on cream or lime. Use explicit labels/shapes as well as color. Arial/Helvetica matches the current implementation. Apply this palette to all new or revised documentation graphics. Retain old ERD images as version history rather than recoloring snapshots and presenting them as new work.

## Validation before acceptance

Review **validity, consistency, completeness, realism and verifiability**. Also review traceability and modifiability from the live lecture. Use the [validation record](SRS_VALIDATION.md). A generated diagram or schema does not by itself validate requirements. Record evidence, reviewer, date, findings and unresolved questions.

## Controlled change

Use the [change-request template](templates/requirements-change-request.md). Record the change ID, reason, affected requirement IDs, before/after wording, impact on diagrams/data/interfaces/tests/schedule, decision owner, decision and version. Never invent stakeholder approval. An unresolved proposal stays a proposal. Update linked artifacts together after the decision.

## Working documentation

Use the [weekly template](templates/weekly-working-documentation.md) for progress, owners, decisions, blockers, requirement changes, evidence and next actions. Use the [test-case template](templates/requirement-test-case.md) for reproducible inputs and expected outcomes. Avoid rewriting the SRS from informal meeting notes without recording the change.
