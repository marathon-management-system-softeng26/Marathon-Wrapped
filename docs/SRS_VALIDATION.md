# SRS V3 validation record

**Specification:** [SRS V3](SRS_v3.md)

**Review date:** October 1, 2026

**Preparation:** Codex, using the supplied SRS V2, lecturer slides/transcript and Bella’s approved project palette.

**Status:** editorial and artifact checks completed; stakeholder agreement and implementation acceptance are not established.

## Lecturer’s validation checks

| Area | Documentary evidence / finding | Status and next step |
| --- | --- | --- |
| Validity | Each requirement has a rationale tied to runner or organizer needs. V2 features remain in scope; new presentation recommendations and two failure-path clarifications are labeled. | Stakeholder review pending. Bella/team must confirm that V3 additions express their needs. |
| Consistency | Existing IDs remain mapped; independent obligations have lettered clauses. Optional Strava/photo data is consistently nonblocking. Known DNF does not invent finish values. | OD-01–OD-07 need team decisions before corresponding behavior can be fully accepted. In particular, source result-cardinality wording and overall-rank policy are unresolved. |
| Completeness | All 55 original V2 requirement IDs remain covered directly or by child clauses. Eight function forms cover runner and organizer behavior; eight graphics cover overview, journeys, UML and architecture. | Within the inherited prototype scope; completeness is not stakeholder-certified. Inspect open decisions and missing upstream reference/roadmap files; the available schema was reviewed statically. |
| Realism | One event, 5K/10K, seeded timing/photos, optional real Strava, free-tier stack and original schedule retained. | Feasibility remains to be confirmed against actual service limits, workload and time. No claim of tested production integration. |
| Verifiability | Every normative clause has a verification measure; the original 95% of 20 loads target is expressed as at least 19 qualifying loads. | OD-08 must fix measurement environment; OD-02/OD-03 must fix calculation policies. Test plans are not executed test evidence. |
| Traceability — live lecture | 67 unique V3 clauses are registered by module, with stable V2 parent references, UR→SR mapping and function/diagram references. | Team must populate implementation issue and actual test-evidence links. |
| Adaptability / modifiability — live lecture | Version history, open-decision owners, module register and change-request form are present. Editable graphic sources and a rebuild script are supplied. | Record future decisions and impacts without renumbering existing IDs or inventing approvals. |

## Artifact checks completed

- Compared V2 requirement ID coverage with V3 normative rows and retained parent mapping.
- Checked that mandatory rows use **shall**, desirable rows use **should**, and no original mandatory parent is only represented by desirable clauses.
- Checked uniqueness of the 67 normative clause IDs and alignment with the requirement register.
- Checked all eight SVGs parse as XML and have accessible titles/descriptions; PNG copies exist.
- Rendered and visually inspected all eight graphics; refined use-case order/actor associations, class multiplicity spacing and the compact overview.
- Checked links among the newly created documentation and diagram assets.
- Read the local schema for conceptual/physical naming, result lifecycle and DNS consistency; no database commands were executed.
- Retained lecturer transcript ambiguities as uncertainties; did not turn uncertain tool names, medical examples or the lecture analogy into project requirements.

## Review findings requiring human decisions

| Finding | SRS decision | Owner |
| --- | --- | --- |
| Exactly-one-result conceptual model versus at-most-one storage rule; distinguish DNS, DNF, missing and invalid data | OD-01 | Bella / Rakha / Embun |
| Tie ranking and comparing 5K versus 10K for “overall” rank | OD-02 | Bella / Embun |
| Early/later split definition, rounding and incomplete/equal splits | OD-03 | Embun / Harry / Shaun |
| Runner identity and organizer access enforcement | OD-04 | Bella / Rakha |
| Strava activity matching, retained data and failed-disconnect recovery | OD-05 | Embun / Bella |
| Export format/dimensions and broken-photo behavior | OD-06 | Indra / Harry / Shaun |
| Atomic save and hero-runner replacement | OD-07 | Rakha / Bella |
| Performance environment, browsers, viewports and starting screens | OD-08 | Shaun / Bella |

## Implementation acceptance — not executed here

Use SRS §9.2 and the [test-case template](templates/requirement-test-case.md). Record actual results, input fixtures, execution environment, dates and evidence before marking a requirement passed. This revision changes documentation and diagrams only; no application code or database migrations are part of this work.
