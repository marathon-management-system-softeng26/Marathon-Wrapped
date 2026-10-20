---
name: Marathon Wrapped
description: The existing Figma Make race recap world, extracted from the implemented interface.
colors:
  red: "#a61729"
  deep: "#7a051d"
  cream: "#fff6ec"
  lime: "#c8f02e"
  muted: "#efd1d0"
  field: "#fffaf4"
  field-border: "#bd9a94"
  surface-secondary: "#efded4"
  surface-secondary-hover: "#e5cdc0"
  surface-quiet-hover: "#efdcd2"
  progress-empty: "#c66b72"
  split-bar: "#d69896"
typography:
  display:
    fontFamily: "Bricolage, Arial, sans-serif"
    fontSize: "clamp(3.8rem, 8vw, 6rem)"
    fontWeight: 800
    lineHeight: 0.96
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Bricolage, Arial, sans-serif"
    fontSize: "clamp(2.6rem, 5vw, 4.5rem)"
    fontWeight: 700
    lineHeight: 1.04
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Bricolage, Arial, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.04
    letterSpacing: "-0.03em"
  body:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 700
  stat:
    fontFamily: "Bricolage, sans-serif"
    fontSize: "clamp(1.8rem, 4vw, 3.6rem)"
    fontWeight: 800
  distance:
    fontFamily: "Bricolage, sans-serif"
    fontSize: "6rem"
    fontWeight: 800
    letterSpacing: "-0.04em"
rounded:
  field: "8px"
  button: "12px"
  panel: "16px"
  circle: "50%"
spacing:
  inline: "8px"
  compact: "12px"
  photo-gap: "16px"
  grid-gap: "20px"
  panel: "24px"
  enrichment: "28px"
components:
  button-primary:
    backgroundColor: "{colors.red}"
    textColor: "{colors.cream}"
    rounded: "{rounded.button}"
    padding: "12px 21px"
  button-primary-hover:
    backgroundColor: "{colors.deep}"
  button-secondary:
    backgroundColor: "{colors.surface-secondary}"
    textColor: "{colors.red}"
    rounded: "{rounded.button}"
    padding: "12px 21px"
  button-secondary-hover:
    backgroundColor: "{colors.surface-secondary-hover}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.red}"
    rounded: "{rounded.button}"
    padding: "9px 12px"
  button-quiet-hover:
    backgroundColor: "{colors.surface-quiet-hover}"
  button-save:
    backgroundColor: "{colors.lime}"
    textColor: "{colors.deep}"
    rounded: "{rounded.button}"
    padding: "12px 21px"
  button-save-hover:
    backgroundColor: "{colors.cream}"
  input:
    backgroundColor: "{colors.field}"
    textColor: "{colors.deep}"
    rounded: "{rounded.field}"
    padding: "11px 12px"
  stat-card:
    backgroundColor: "{colors.cream}"
    textColor: "{colors.deep}"
    rounded: "{rounded.panel}"
    padding: "24px"
  button-circle:
    backgroundColor: "{colors.cream}"
    textColor: "{colors.deep}"
    rounded: "{rounded.circle}"
    padding: "0"
    width: "52px"
    height: "52px"
---

# Design System: Marathon Wrapped

## Overview

**Creative North Star: "Existing Figma Make visual world"**

The existing Figma Make visual world is the authority: an immersive race-red field, cream statistic panels, lime emphasis and expressive Bricolage lettering. The recap uses Experience mode; sign-in, runner selection and organizer management use Operate mode with cream surfaces, readable forms and red actions.

The world is typographic and flat. Large race measurements, a split chart, photographic moments and a final keepsake give the story its rhythm. The reference portrait is not copied; the introduction uses type and color. Existing stock photography remains explicitly simulated and attributed.

**Key Characteristics:**
- Race red, cream and lime carry identity across both modes.
- Bricolage display type pairs with familiar system sans body text.
- Flat panels and generous numeric scale create hierarchy.
- Direct progress buttons and visible focus keep the story navigable.

## Colors

The frontmatter owns exact values; names below describe their observed roles.

### Primary
- **Race red (`red`):** immersive story background and Operate actions.
- **Deep race red (`deep`):** text on cream, button hover and photographic overlays.

### Secondary
- **Race lime (`lime`):** highlighted phrases, distance, save action and story focus outlines.

### Neutral
- **Warm cream (`cream`):** story text, statistic panels and Operate canvas.
- **Muted rose (`muted`):** supporting story copy.
- **Warm field (`field`, `field-border`):** readable form fill and edge.
- **Warm secondary surfaces:** secondary actions and quiet hover feedback.
- **Rose progress and split bars (`progress-empty`, `split-bar`):** inactive progress and ordinary split bars; fastest split uses race red.

**The Existing World Rule.** Extend the supplied visual world; do not replace its palette or display character.

## Typography

**Display Font:** Bricolage Grotesque, registered locally as `Bricolage`, with Arial/sans-serif fallbacks. The variable font is served from `public/fonts/bricolage.ttf`; `public/fonts/PROVENANCE.md` records its Google Fonts source and SIL Open Font License.

**Body Font:** Arial, Helvetica, sans-serif. Operate uses the system body stack, with Bricolage reserved for headings and the wordmark.

The frontmatter describes actual roles rather than a newly imposed modular scale. Story display is fluid; on narrow screens the introduction becomes 4rem and story headlines 2.6rem. General Operate h1 is 4.25rem, reducing to 3rem; organizer h1 is 3rem. The login headline is fluid from 3rem to 6rem and becomes 3.25rem at the mobile breakpoint. Paragraphs use a 70ch maximum; leads use 46ch and story introductions 38ch. Statistic values and tables use tabular numerals.

**The Display Ceiling Rule.** Interface display type stops at 6rem and tracking stays at or above -0.04em. The exported canvas has its own pixel scale.

## Layout

Operate content is centered at a maximum 1100px with 24px horizontal padding. The story uses a centered 1020px spatial frame with at least 24px horizontal padding. Six equal progress segments sit above story content. Statistic cards form two columns with a 20px gap; the chart is at most 900px wide. Photo thumbnails wrap with a 16px gap.

The existing responsive breakpoint is 700px. Login switches from a 1.15fr/1fr split to stacked blocks; forms collapse to one column and the toolbar stacks. Story horizontal padding becomes 22px, statistic gaps become 12px, and the two statistic columns remain. Tables scroll inside their own container. Recap navigation follows the content rather than covering it.

The keepsake preview uses the same canvas renderer as the download: 1080 by 1350 pixels, displayed at up to 350px wide with a 4:5 ratio. Its race-red field, lime title and cream statistic panel repeat the interface palette. This raster coordinate system is separate from interface spacing and font sizes.

## Elevation & Depth

No box-shadow vocabulary exists. Cream panels on red, warm tonal surfaces in Operate, and a dark translucent photo-dialog backdrop supply separation. The dialog backdrop is `#36050dcc`. Story content reveals with a 0.4s clipped/blurred transition; state feedback uses a 0.18s background transition and photo hover uses a 0.2s scale transition. Reduced-motion mode disables authored animation and transitions.

**The Flat Panel Rule.** Use color contrast and spacing to establish depth; existing panels have no box shadows.

## Shapes

The frontmatter records the reusable radius scale: soft fields, fuller buttons, cream panels and circles. Panels, photo thumbnails and dialogs use the panel radius; the photo overlay uses the field radius. Split bars round only their top corners (7px); progress lines use a 5px radius. The export canvas uses a 32px panel radius at its own raster scale.

## Components

### Buttons

Primary actions are race red on cream, with cream text and a deep-red hover. Secondary and quiet variants use warm tonal hover feedback. The lime save variant uses deep-red text and cream hover. Shared controls have a 46px minimum height and bold system text. Disabled controls reduce opacity to 0.5. Global keyboard focus has a 3px red outline offset by 4px; the story changes this to lime. Story arrow controls are 52px circles, with cream fill and lime hover; unavailable directions are hidden.

### Inputs / Fields

Fields use warm fill, a thin muted border, deep-red text and a red caret. Their minimum height is 46px, with an 8px gap after the label. Read-only fields use a warmer muted fill; checkboxes use race red. Error feedback is a separate tinted panel. No bespoke invalid-field border is implemented.

### Navigation

Six directly selectable progress buttons use equal columns. A cream bar marks reached pages; muted rose marks unreached pages; the current label uses lime. Buttons expose the current step semantically. Mobile reduces gaps and label size while preserving all six destinations. The Operate header pairs the Bricolage wordmark with a quiet sign-out action.

### Cards / Containers

Statistic cards use cream fill, deep-red values, the panel radius and 24px padding; mobile padding becomes 20px 14px. Enrichment panels use the same materials with 28px padding, becoming 22px on mobile. They communicate disconnected or sample-data states without changing the visual world. The split chart uses cream fill and red emphasis on the fastest recorded split.

### Photographic moments and keepsake

Race photos appear as 240 by 290px cropped thumbnails. Hover scales the image to 1.03; a text overlay opens the cream native dialog. The existing shared stock photo is Martin Vorel's *Marathon runners*, hosted locally and recorded in `public/photos/PROVENANCE.md` with its LibreShot CC0 source and checksum. It is a simulated BIB mapping, not a portrait of the selected runner. The source-reference portrait remains absent. The final keepsake is typographic and contains no photo or health metrics.

## Do's and Don'ts

### Do:
- Do inherit the pinned Figma Make world when extending the interface.
- Do use locally hosted Bricolage for display type and system sans for Operate body text.
- Do keep measured values legible, with tabular numerals in statistic panels and tables.
- Do keep stock-photo attribution and visible simulated-data labels.
- Do respect reduced-motion preferences.

### Don't:
- Don't replace the established red, cream and lime world with a new identity.
- Don't copy the source-reference portrait or commit the read-only reference export.
- Don't invent hydration, missing timing or a live Strava connection.
- Don't add decorative shadows to the flat panel system.
