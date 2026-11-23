# Flexible UI Breakpoints — Design

## Intent

Make the existing Figma-aligned interface adapt cleanly from 320 px phones through tablets and wide desktops without redesigning its red/cream/lime identity or changing application behavior.

## Goals

- Remove clipping, horizontal page overflow, cramped controls, and awkward unused space at the current breakpoints.
- Keep forms, navigation, race cards, Strava states, the seven-scene Wrapped, and organizer tools readable and operable with touch, keyboard, and zoom.
- Preserve the existing mobile-first story composition and the desktop split-screen authentication design.
- Verify representative widths around 320, 390, 768, 1024, 1440, and 1920 px.

## Non-goals

- No new visual identity, route, API, or product workflow.
- No migration to a new CSS framework or component library.
- No change to official-result, Strava, authentication, export, or organizer behavior.

## Approaches considered

1. **Targeted breakpoint repair — selected.** Keep the current CSS and components, consolidate conflicts only where they cause responsive defects, and add page-specific corrections. This is the smallest change and preserves the approved Figma implementation, at the cost of retaining more breakpoint-specific CSS.
2. **Unified fluid responsive system — not selected.** Rework tokens, containers, and breakpoints across the entire app. This would be easier to maintain long term but carries more visual and regression risk than requested.

## Responsive behavior

- **Global shell:** navigation wraps or compacts without hiding destinations; content gutters use available width; focus indicators stay visible.
- **Authentication and registration:** image/form split remains at wide widths, stacks at tablet/phone widths, labels remain visible, and controls fill the available column without becoming excessively wide.
- **Runner dashboard and profile:** race passes and form rows collapse to one column before content becomes cramped; long names, BIBs, and status copy wrap safely.
- **Strava journey:** candidate cards, action groups, metrics, and feedback remain inside the viewport; buttons become full-width where touch layouts benefit.
- **Wrapped story:** seven progress segments, headings, illustrations, statistics, photos, share preview, and fixed controls stay inside safe areas in portrait, landscape, and desktop layouts.
- **Organizer:** toolbar, editor grids, access rows, configuration fields, and tables adapt independently; tables scroll within their own container instead of widening the page.

## Acceptance

- No horizontal document overflow at the target widths.
- No overlapping or clipped interactive controls.
- Touch targets and form fields remain usable at 320 px.
- Keyboard navigation and reduced-motion behavior remain intact.
- Existing automated tests, lint, typecheck, and production build pass.
- Browser screenshots are inspected at phone, tablet, laptop, and wide-desktop widths.
