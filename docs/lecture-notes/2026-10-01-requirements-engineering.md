# Requirements engineering lecture notes — October 1, 2026

**Captured for:** Marathon Wrapped SRS, UML, flowcharts, validation and future working documentation.

**Sources:** nine supplied photos (some duplicate views) and Bella’s live speech-to-text excerpt.

**Status:** source-grounded notes, not a verbatim verified lecture recording. Slide content and transcript interpretation are distinguished below.

## 1. Writing requirements — slide 20

- Use a standard format consistently throughout the specification.
- **Shall = mandatory. Should = desirable.** Do not substitute one for the other merely to vary wording.
- Highlight the key parts of a requirement.
- Avoid computer jargon in user-facing requirements.
- Include a rationale explaining why each requirement exists.
- Avoid lack of clarity, confusion between functional and non-functional requirements, and several unrelated requirements amalgamated into one paragraph.
- The slide’s insulin-pump example includes a concrete interval and an explanation of why that interval was chosen. The useful lesson is a measurable requirement plus a reason; its medical content is not a requirement for this project.

## 2. Structured/function specifications — slide 21

The form-based checklist includes:

1. Definition of the function or entity.
2. Inputs and where they come from.
3. Outputs and where they go.
4. Information needed for the computation.
5. Action to be taken.
6. Preconditions and postconditions.
7. Side effects, if any.

The example also labels description, source and destination. Empty fields expose questions that might otherwise be missed. Structure acts as a checklist rather than just a neat layout. The slide says this approach works well for embedded control systems and can be too rigid for business systems: adapt the level of detail to the project instead of copying medical-system complexity.

**Project application:** FS-01–FS-08 in SRS V3 use these fields, with explicit exception paths and requirement references. Use “none” or a stated open decision rather than leaving a field blank.

## 3. Readable versus precise — slide 17

- Requirements specification records user requirements and system requirements.
- User requirements must be understandable to end users and customers without technical backgrounds.
- System requirements need detailed precision and completeness; they may form part of a contract.
- Manage these two audiences intentionally: everyday user statements and diagrams first, technical rules in their own section.

**Project application:** a runner journey and role-based use cases explain the experience. Calculation rules, record relationships and test measures live in system requirements and structured function forms.

## 4. Software requirements document structure — slide 24

The visible descriptions call for:

| Area | Information to preserve |
| --- | --- |
| Preface / document control | Expected readership; version history; reason for a new version; summary of each revision. The left column is partly cropped, so “preface / document control” is an interpretation of the visible description. |
| Introduction | Need for the system; principal functions; interaction with other systems; fit with the commissioning organization’s business or strategic objectives. |
| Glossary | Explain technical terms without assuming reader expertise. |
| User requirements | Services for the user and quality requirements; natural language and diagrams understandable to customers; applicable product/process standards. |
| System architecture | High-level anticipated architecture; distribution of functions across modules; reused components identified. |

Only the rows visible in these photos are captured here. Do not infer unseen rows as material the lecturer supplied.

## 5. Requirements validation — slide 25

| Check | Question from the slide | Project application |
| --- | --- | --- |
| **Validity** | Do the functions support the customer’s real needs? | Confirm each requirement’s user need and rationale with Bella/team; do not add out-of-scope registration, payment or hydration features. |
| **Consistency** | Are there conflicts between requirements? | Check DNF rules, result cardinality, optional enrichment, stable BIB, actor permissions and matching IDs across diagrams/forms. |
| **Completeness** | Are all needed functions included? | Cover runner and organizer goals, alternative outcomes, data, quality constraints and traceability; record unresolved details explicitly. |
| **Realism** | Can this be built with available budget and technology? | Check prototype scope, free tiers, time, staffing, real Strava dependencies and simulated timing/photos. |
| **Verifiability** | Can the requirement be checked? | Write acceptance measures or tests with inputs and expected results. Record the environment for numerical targets. |

The slide emphasizes that a requirement without a writable test is only a wish. It also states that fixing a requirements error after delivery may cost up to 100 times an implementation-error fix because the error affects architecture, tests, training and contract. Preserve that as the lecturer’s illustrative claim, not a measured multiplier for Marathon Wrapped or a universally verified statistic.

**Important distinction:** requirement validation asks whether the specified system is appropriate and coherent. Software acceptance testing checks whether the implementation satisfies the specification. A readable document, a schema generator or a generated interface does not prove either by itself.

## 6. Live spoken notes — interpreted carefully

The following points are clear enough to retain from the transcript:

- Requirements need correctness/validity checks: do the stated measures and values make sense for the intended user?
- Check whether a requirement can be verified.
- A specification should cover all required functions and constraints.
- Numbering matters for tracking. Give **each requirement a unique ID**.
- Organizing requirement rows by module is suggested as a way to make changes easier to track.
- Requirements change is inevitable. Leave room to adapt the specification rather than treating the first version as permanent.
- Review the impact of a change so it does not cause uncontrolled changes elsewhere.
- Balance client needs, user needs and feasible compromises; make the chosen tradeoff visible.
- Tools can help manage requirements and models, but the lecture does not establish any one named tool as compulsory for this project.

### Uncertain wording — retain, do not silently “correct”

| Transcript wording | Interpretation status |
| --- | --- |
| “make the size using the Prisma” | Tool name and intended modeling operation unclear. Could refer to a modeling tool, but no specific tool is confirmed. |
| “Visual Studio … Not Visual Studio … Microsoft Visual” | Lecturer self-correction; exact product unclear. Microsoft Visio is a possible interpretation, not a confirmed instruction. |
| “generate the interface automatically … in Java” | A code/interface-generation example is mentioned; generator name and details are missing. |
| “best case generation, manually” | Possibly “test case generation.” That is an interpretation, not a reliable verbatim term. |
| “press HR … medical supplier” | Example/action unclear. Do not convert it into a Marathon Wrapped requirement. |
| “preservability” | Context about document numbers suggests traceability, but the exact term is unclear. Preserve the intent to track requirements using unique IDs. |
| “adaptability” | Context suggests modifiability and controlled change impact. Do not claim a formal definition the transcript does not establish. |
| Relationship / “gorilla” analogy | Informal speech-to-text example illustrating changing preferences; not a project rule or statement about users. |

## 7. Practical documentation conventions for this project

These are applications of the lecture to Marathon Wrapped, not verbatim slide text:

- Keep existing IDs stable; never renumber them just because rows move.
- Group by module using a module field; retain the V2 IDs to avoid breaking references.
- If an ID contains independent obligations, retain the parent reference and use lettered clauses.
- Trace each user requirement to system requirements, function forms, diagrams and test evidence.
- For each change, record the reason, author/owner, affected IDs, affected artifacts, acceptance impact and decision.
- Treat open issues as open; record an owner and next action rather than filling gaps with guesses.
- Use the approved Soekarno Run red/cream/lime palette across new or revised assets, with readable contrast and labels that do not depend on color alone.
- Match model names and outcomes to the SRS. Use cases show goals/actors, activities show behavior, sequences show interaction order, and classes show concepts/relationships.
- Write actual validation evidence separately from planned tests. Do not mark an untested requirement “passed.”

## 8. Source inventory

All supplied image paths are retained as original sources on Bella’s machine; the files were not moved or modified.

| Source | Original filename | Topic |
| --- | --- | --- |
| A1 | `WhatsApp Image 2026-10-01 at 11.34.39 (2).jpeg` | Form-based specification, slide 21 |
| A2 | `WhatsApp Image 2026-10-01 at 11.34.39 (3).jpeg` | Natural-language specification, slide 20 |
| A3 | `WhatsApp Image 2026-10-01 at 11.34.39.jpeg` | Duplicate view of slide 20 |
| A4 | `WhatsApp Image 2026-10-01 at 11.34.40 (1).jpeg` | Another view of slide 21 |
| A5 | `WhatsApp Image 2026-10-01 at 11.34.40.jpeg` | Readable versus precise, slide 17 |
| A6 | `WhatsApp Image 2026-10-01 at 11.34.41.jpeg` | Another view of slide 17 |
| B1 | `WhatsApp Image 2026-10-01 at 11.41.50 (1).jpeg` | Requirements document structure, slide 24 |
| B2 | `WhatsApp Image 2026-10-01 at 11.41.50 (2).jpeg` | Duplicate view of slide 24 |
| B3 | `WhatsApp Image 2026-10-01 at 11.41.50.jpeg` | Validation checks, slide 25 |
| T1 | [Preserved speech-to-text excerpt](2026-10-01-live-transcript.txt) | Live explanation of validation, unique IDs and changing requirements |
