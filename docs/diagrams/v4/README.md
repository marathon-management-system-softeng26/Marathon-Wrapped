# SRS V4 diagrams

Five diagrams supporting [SRS V4](../../SRS_v4.md). Each has an editable PlantUML source and an SVG preview. PNG copies are convenient for slides and documents.

| Diagram | Preview | Editable source | Coverage |
| --- | --- | --- | --- |
| Context diagram | [SVG](context-diagram.svg) · [PNG](context-diagram.png) | [PlantUML](context-diagram.puml) | System boundary and external interactions |
| Activity diagram | [SVG](activity-diagram.svg) · [PNG](activity-diagram.png) | [PlantUML](activity-diagram.puml) | Runner journey, FR-01–FR-15 |
| Sequence diagram | [SVG](sequence-diagram.svg) · [PNG](sequence-diagram.png) | [PlantUML](sequence-diagram.puml) | Main requirement FR-01 with FR-02–FR-07 and optional stored data |
| Business process diagram | [SVG](business-process-diagram.svg) · [PNG](business-process-diagram.png) | [PlantUML](business-process-diagram.puml) | Organizer preparation through runner recap and sharing, FR-01–FR-18 |
| Class diagram | [SVG](class-diagram.svg) · [PNG](class-diagram.png) | [PlantUML](class-diagram.puml) | All seven ERD v5 entities, attributes, and associations |

## Model notes

- Main sequence: viewing a personal recap. Opening the page does not start OAuth.
- DNF is a known race status. Missing results and DNS are not automatically DNF; OD-01 remains open.
- Class source: `docs/erd-v5.png`, verified visually, and `docs/erd.md`. UUID identifiers, bigint event/category identifiers, BIB photo matching, and all attributes are preserved.
- ERD v5 shows exactly one result and one or more splits. This class diagram preserves that started-runner conceptual model. Current physical schema permits zero result/split rows; v5's own notes exclude DNS. This is documented rather than silently changed.
- No new inheritance or composition is invented. Data classes intentionally omit methods not supported by ERD v5.
- The business process uses UML activity lanes; it is not a BPMN 2.0 model.
- Recap service and calculation lifelines express proposed responsibilities, not confirmed implementation class names.
- Rank, split comparison, Strava activity matching, authorization enforcement, and other open policies remain the decisions in SRS V4 section 7.

## Rebuild

Install Java, PlantUML, and Graphviz, then run from the repository root:

```sh
java -jar /path/to/plantuml.jar -tsvg docs/diagrams/v4/*.puml
java -jar /path/to/plantuml.jar -tpng docs/diagrams/v4/*.puml
```

Adjacent `.spec.json` files record the content and style basis; `.prompt.txt` files state rendering constraints. The `.puml` sources contain the exact labels and relationships.
