# SRS V3 visual guide

[SRS V3](../../SRS_v3.md) diagrams in the approved Soekarno Run red, cream and lime palette.

| Asset | What it explains | Requirement/function references |
| --- | --- | --- |
| [Overview](overview.svg) | Race results become a recap with optional additions, then an image | UR-F1–UR-F6 |
| [Runner flow](runner-flow.svg) | Result lookup, finisher/DNF content, optional detail, export and recovery | FS-01, FS-02, FS-06; SR-F23 |
| [Strava flow](strava-flow.svg) | Voluntary consent, available metrics, fallback and successful disconnect | FS-03, FS-04; UR-F3–UR-F4 |
| [Organizer flow](organizer-flow.svg) | Event results, demo data edits, accepted/rejected saves | FS-07, FS-08; SR-F24 |
| [Use case diagram](use-case-diagram.svg) | Runner/organizer goals and external Strava participation | UR-F1–UR-F9 |
| [UML activity](activity-diagram.svg) | Actions, responsibility labels, guards, merge and export retry | FS-01, FS-02, FS-06 |
| [UML classes](class-diagram.svg) | Conceptual information groups and relationship counts | SRS §3; OD-01 |
| [Architecture](architecture.svg) | Anticipated module responsibilities and reused platforms | SRS §8.1 |

SVG and PNG versions are included for each diagram.

Editable UML: [use cases](use-case-diagram.puml) · [activity](activity-diagram.puml) · [classes](class-diagram.puml).

To rebuild, use Python 3, Graphviz and `rsvg-convert`:

```sh
python3 docs/diagrams/v3/build_diagrams.py
```
