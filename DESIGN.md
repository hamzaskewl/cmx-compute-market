---
name: Compute Market
description: A calibrated graphite ledger for trustworthy GPU-hour reference indexes on Solana.
colors:
  graphite-canvas: "#192226"
  landing-canvas: "#1a2428"
  docs-canvas: "#182226"
  graphite-header: "#172126"
  graphite-panel: "#1d282c"
  graphite-ledger: "#1b252a"
  graphite-sheet: "#222c38"
  graphite-selected: "#202d32"
  periwinkle: "#959cf7"
  periwinkle-hover: "#b0b5ff"
  periwinkle-focus: "#a9afff"
  ink: "#f4f4f5"
  ink-secondary: "#d2d8e3"
  ink-muted: "#aeb8c9"
  calibrated-rule: "#506068"
  action-ink: "#11151d"
  docs-callout: "#202c31"
typography:
  display:
    fontFamily: "Onest, sans-serif"
    fontSize: "clamp(76px, 6.4vw, 96px)"
    fontWeight: 650
    lineHeight: 0.96
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Onest, sans-serif"
    fontSize: "34px"
    fontWeight: 620
    lineHeight: 1.2
    letterSpacing: "-0.035em"
  title:
    fontFamily: "Onest, sans-serif"
    fontSize: "18px"
    fontWeight: 550
    lineHeight: 1.2
    letterSpacing: "normal"
  body:
    fontFamily: "Onest, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.7
    letterSpacing: "normal"
  label:
    fontFamily: "Azeret Mono, monospace"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "0.035em"
  data:
    fontFamily: "Azeret Mono, monospace"
    fontSize: "clamp(26px, 2.15vw, 34px)"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.03em"
  action:
    fontFamily: "Onest, sans-serif"
    fontSize: "15px"
    fontWeight: 650
    lineHeight: 1
    letterSpacing: "normal"
  link:
    fontFamily: "Onest, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "normal"
  navigation:
    fontFamily: "Onest, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "normal"
rounded:
  square: "0"
  circle: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  control-gap: "18px"
  mobile-gutter: "22px"
  ledger-gutter: "32px"
  desktop-gutter: "44px"
  masthead: "72px"
components:
  button-primary:
    backgroundColor: "{colors.periwinkle}"
    textColor: "{colors.action-ink}"
    typography: "{typography.action}"
    rounded: "{rounded.square}"
    padding: "0 26px"
    height: "54px"
  button-primary-hover:
    backgroundColor: "{colors.periwinkle-hover}"
    textColor: "{colors.action-ink}"
    rounded: "{rounded.square}"
  button-compact:
    backgroundColor: "{colors.periwinkle}"
    textColor: "{colors.action-ink}"
    rounded: "{rounded.square}"
    padding: "0 22px"
    height: "44px"
  ledger-row:
    backgroundColor: "{colors.graphite-ledger}"
    textColor: "{colors.ink}"
    rounded: "{rounded.square}"
    height: "102px"
  ledger-row-selected:
    backgroundColor: "{colors.graphite-selected}"
    textColor: "{colors.ink}"
    rounded: "{rounded.square}"
    height: "102px"
  docs-callout:
    backgroundColor: "{colors.docs-callout}"
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.square}"
    padding: "22px 24px"
  text-action:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.link}"
    rounded: "{rounded.square}"
  navigation-link:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.navigation}"
    rounded: "{rounded.square}"
  mechanism-step:
    backgroundColor: "{colors.graphite-sheet}"
    textColor: "{colors.ink}"
    rounded: "{rounded.square}"
    padding: "18px 0"
  status-badge:
    backgroundColor: "transparent"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.label}"
    rounded: "{rounded.square}"
    padding: "10px 13px"
---

# Design System: Compute Market

## Overview

**Creative North Star: "The Calibrated GPU Ledger"**

Compute Market feels like a benchmark instrument made public: deep graphite sheets, cool hairline registration, compact hardware plates, and one scarce periwinkle signal. It is authoritative without borrowing the visual noise of a crypto trading terminal, and technical without becoming a generic developer dashboard.

The landing surface operates at a glance while the documentation surface slows into a measured read. Both surfaces share the same strict grid, square controls, disciplined type pairing, and truth-first product posture. The interface may look active only when its data is verifiably active; visual density never licenses fabricated market activity.

**Key Characteristics:**

- Graphite-on-graphite tonal layering with calibrated one-pixel rules.
- Dusty periwinkle used as a registration signal, not a decorative wash.
- Onest for confident product hierarchy; Azeret Mono for measurements and system labels.
- Square actions and containers contrasted with circular process markers.
- Compact generated GPU plates registered to a stable quote grid.
- Real source data or an explicit unavailable/deployment state—never simulated activity.

## Colors

The palette is a cool graphite field punctuated by a single dusty-periwinkle signal and high-clarity neutral type.

### Primary

- **Registration Periwinkle** (`periwinkle`): actions, active registration marks, process icons, compact section labels, and selection color. Its brighter hover and focus variants provide state without introducing another accent family.

### Neutral

- **Graphite Canvas** (`graphite-canvas`): the global page ground and scrollbar track beneath the routed surfaces.
- **Landing Canvas** (`landing-canvas`): the landing surface’s primary field.
- **Documentation Canvas** (`docs-canvas`): the reading surface’s primary field.
- **Header Graphite** (`graphite-header`): mastheads and persistent chrome.
- **Panel Graphite** (`graphite-panel`): card and popover baseline.
- **Ledger Graphite** (`graphite-ledger`): the index register behind quote rows.
- **Mechanism Sheet** (`graphite-sheet`): a cooler tonal band separating protocol explanation from the ledger.
- **Selected Graphite** (`graphite-selected`): hover, focus-within, and selected ledger-row state.
- **Primary Ink** (`ink`): headlines, instrument names, prices, and high-priority content.
- **Secondary Ink** (`ink-secondary`): navigation and supporting links.
- **Muted Ink** (`ink-muted`): specifications, footer notes, and lower-priority context.
- **Calibrated Rule** (`calibrated-rule`): the recurring one-pixel grid, divider, and outline.

**The Calibrated Contrast Rule.** Periwinkle marks action, focus, selection, or protocol sequence; never spread it into gradients, decorative glows, or large background fields.

## Typography

**Display Font:** Onest (with sans-serif fallback)

**Body Font:** Onest (with sans-serif fallback)
**Label/Mono Font:** Azeret Mono (with monospace fallback)

**Character:** Onest makes the product direct, compact, and contemporary without losing warmth. Azeret Mono supplies the restrained measurement face that makes prices, dates, labels, and status read like registered instrument output.

### Hierarchy

- **Display** (650, fluid 76–96px, 0.96 line-height): short hero statements; the mobile landing treatment shifts to a fluid 58–78px range, and documentation uses a fluid 56–92px range.
- **Headline** (620, 34px, compact): documentation section headings; reduce to 30px on the narrowest layout.
- **Title** (650, 18–25px): brand names, mechanism steps, and concise content titles.
- **Body** (400, 17px, 1.7 line-height): documentation prose, capped near 680–690px so technical copy remains easy to scan. Landing support copy uses 20px at 1.45 line-height.
- **Label** (600, 10–13px, tracked uppercase): column headers, metadata, section labels, and status text.
- **Data** (600, fluid 26–34px, tabular numerals): GPU-hour prices. Narrow rows reduce values to 17px while preserving the mono face.

**The Measurement Face Rule.** Use Azeret Mono only where alignment, sequence, status, or numeric comparison matters; never use it for paragraphs or large expressive headlines.

## Layout

The landing page is a ruled two-column instrument plate: a 40% proposition column and a 60% ledger column beneath a 72px masthead. The desktop hero holds a 638px minimum height, uses 44px outer gutters, and treats the five-row quote register—not an aggregate metric—as the dominant information object. Documentation centers a 1,500px shell with a 280px sticky sidebar and a reading column capped at 980px, with prose held to roughly 680–690px.

At 1,180px the landing navigation disappears, the two columns tighten to 38%/62%, and the quote grid reduces its hardware and source widths. At 860px the hero stacks, source cells disappear, and the mechanism becomes a single vertical sequence. At 560px the masthead source action becomes a 44px icon-only square, metadata becomes a two-column grid, ledger rows compress to 92px with prices pinned right, and the GPU plate shrinks to a 68px box. Documentation collapses its sidebar into a horizontal scrolling section rail at 820px and reduces its back control and display scale at 560px.

**The Fixed Registration Rule.** Selecting an index must not move or resize the quote grid; reveal the periwinkle registration bar and specification lines inside the row’s existing height.

## Elevation & Depth

The system has no box shadows. Depth comes from adjacent graphite sheets, one-pixel cool rules, and a small tonal lift for interactive rows. The documentation masthead alone uses a restrained translucent graphite and 12px backdrop blur to preserve orientation while scrolling; the blur is removed when reduced motion is requested.

**The Flat Instrument Rule.** Surfaces remain flat at rest; hierarchy is expressed through tone, rule weight, and registration—not drop shadows, glow, or floating cards.

## Shapes

Actions, quote rows, callouts, status capsules, and content containers are square. Brand geometry is a small assembly of overlapping rectilinear blocks. Circles are reserved for the three-step mechanism’s numbered markers and line icons, where they denote sequence rather than softness. GPU plates are compact generated cutouts presented as object-contained stamps (112 × 86px on desktop) and never expanded into hero photography.

**The Square Action Rule.** Keep clickable actions and information plates unrounded; reserve the 50% circle treatment for mechanism markers and icons only.

## Components

### Buttons

- **Shape:** square with no radius; the standard source action is 54px tall, while masthead and narrow-screen controls are 44px tall.
- **Primary:** registration periwinkle with dark action ink, semibold Onest, and a right arrow separated by an 18px gap.
- **Hover / Focus:** brighten to the periwinkle hover token; use the global 2px focus outline with a 4px offset.
- **Text action:** secondary ink with a one-pixel underline, 6px underline offset, and white hover state.

### Cards / Containers

- **Corner Style:** square.
- **Background:** neighboring graphite tones distinguish the ledger, mechanism, selected rows, and documentation callouts.
- **Shadow Strategy:** none; rely on tonal changes and calibrated rules.
- **Border:** one-pixel cool graphite rules.
- **Internal Padding:** 22–24px for compact documentation callouts; major surface gutters use 22px on mobile and 42–44px on desktop.

### Navigation

The masthead keeps the brand left, a quiet 14px center navigation on wide screens, and the methodology action right. Navigation is hidden below 1,180px rather than squeezed. Documentation uses a sticky left index on desktop and a horizontal overflow rail below 820px; links brighten to white on hover and keep the current surface visually quiet.

### Index Ledger

Each desktop row is a fixed 102px, three-column register for GPU identity, tabular price, and composite method. A transparent full-row button changes the selected instrument; the method links to the pricing explanation. Hover, focus-within, and selection raise the row tone, scale a 3px periwinkle marker at the left edge, and reveal architecture plus memory without changing row geometry. The first real index is selected initially. If the composite feed returns no indexes, the entire market register is replaced by a plain unavailable message.

### GPU Plates

H100, H200, B200, A100, and RTX 5090 use tightly framed, high-resolution voxel product plates with hard silhouettes and discrete stepped shading. Plates stay object-contained on the same grid without runtime enlargement or tone filters. They identify the instrument; they never imply inventory, availability, or live market supply.

### Mechanism Steps

Three steps use a mono sequence number, circular line icon, and concise Onest label on a cooler graphite sheet. Desktop arranges them as a horizontal flow with arrows; mobile removes arrows and sequence numbers, then stacks each step behind a divider. This component describes protocol design, not deployment status.

### Documentation States

Callouts are square, one-pixel outlined, and tonally lifted. Deployment state uses a small neutral square indicator and Azeret Mono uppercase text. Status language is explicit: deployed, live, and active claims appear only when the underlying configuration verifies them.

**The Evidence Before Interface Rule.** Never make a screen look more alive by inventing prices, movement, balances, volume, liquidity, deployment, transactions, or launch activity.

## Do's and Don'ts

### Do:

- **Do** let the latest verified GPU-hour prices and their source dominate the operating surface.
- **Do** keep selected-row feedback inside the fixed ledger geometry and preserve tabular numeric alignment.
- **Do** use compact generated GPU plates as instrument identifiers with clear model, architecture, and memory labels.
- **Do** collapse structure deliberately at 1,180px, 860/820px, and 560px instead of merely shrinking the desktop composition.
- **Do** remove ledger transitions and the selected specification reveal transition under `prefers-reduced-motion: reduce`.
- **Do** replace unavailable or unverified activity with a truthful state, an omitted control, or a direct source link.

### Don't:

- **Don't** fabricate prices, percentage changes, balances, tokens, launches, liquidity, deployment status, or transaction activity.
- **Don't** use dark-neon crypto gradients, luminous glows, rounded dashboard cards, or oversized photoreal hardware art.
- **Don't** turn periwinkle into a broad decorative fill; keep it scarce and functional.
- **Don't** use Azeret Mono for long-form prose or Onest for tabular prices and calibrated labels.
- **Don't** let interaction change quote-row height, column registration, or the position of neighboring instruments.
- **Don't** present prototype economics as live market performance.
