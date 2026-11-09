# UI redesign, stage 1: design system, shell and motion

Date: 2026-10-25. Branch: `ui-redesign-stage1`. Status: approved in conversation, section by section.

## 1. Goal and scope

Make the Feeder Island client look and feel like a premium engineering product: consistent on every
page, with depth (stage 1's "3D") and purposeful motion, without losing readability, speed, offline
use or the accessibility already achieved.

In scope: the shared stylesheet, a new app shell (sidebar, top bar, Ctrl+K palette, page header),
restyled shared components, chart/map/diagram theming, a motion system, print styles, and a polish
pass on the most-used pages.

Out of scope:

- The engine (`packages/engine/`) and every calculation. No result may change.
- The server.
- Stage 2: a real 3D (WebGL) view of the feeder network. It gets its own design and approval later.

Users: distribution engineers, mostly on desktop, sometimes on phones in the field (installable,
offline PWA). Three languages (English; Sinhala and Tamil as machine drafts). Light and dark themes
both stay.

## 2. Decisions taken

| Question | Decision |
|---|---|
| What "3D" means | Both, in two stages. Stage 1: depth, light and motion. Stage 2: 3D network view. |
| Navigation | Grouped, collapsible left sidebar plus a Ctrl/⌘+K command palette. |
| Visual direction | "Precision instrument": dark-first, graphite glass, hairlines, faint grid, luminous signal colours. Light theme is a cool, crisp counterpart. |
| Motion level | Purposeful and quick: 120–280 ms, only where it explains something. |
| Build approach | Rebuild `styles.css` as a design system plus small React components. No new runtime libraries. |

## 3. Constraints found in the code

- All styling is one file, `client/src/styles.css` (13 KB), driven by CSS custom properties. Pages use
  shared classes (`.card`, `.stat`, `button.primary`, `.pill`, tables, inputs).
- 518 inline `style={{…}}` objects across 57 files; almost all use `var(--…)`. Only 3 hard-coded
  colours in JSX (`DailyPage.jsx` 1, `MapPage.jsx` 2) and 4 in `lib/sld/svg.js`.
- `lib/chartTheme.js` holds literal chart colours that must stay in step with the CSS tokens.
- `pages/SetupPage.jsx` finds `header.top` and reads its height to offset scrolling to a section.
  The new top bar keeps the `top` class on a `<header>` element.
- i18n: `lib/__tests__/i18n.test.js` requires every literal `t('…')` key to be in `en.json`, and
  `si.json`/`ta.json` to have exactly the English keys. Every new UI string is added to all three
  (Sinhala/Tamil as machine drafts, as today). Missing keys already fall back to English at runtime.
- Routing is `<Routes>` (not a data router), so React Router's view-transition support is not
  available. Page entrances use a CSS animation keyed on the route instead.
- The Wizard route (`/app/wizard`) is not in today's tab list; it is reached from Setup. That stays.
- Previous verification: axe-core (WCAG 2.1 A/AA) 0 violations on all 22 tabs in both themes;
  no horizontal scroll at 390 px. The redesign must meet the same bar.

## 4. Visual language

### 4.1 Colour tokens

All text colours were checked numerically against WCAG 2.1: every pairing below is at least
5.2:1, including each status colour on its own 14% tinted pill.

| Token | Dark | Light | Role |
|---|---|---|---|
| `--bg` | `#070B12` | `#EEF2F7` | Page background |
| `--panel` | `#101827` | `#FFFFFF` | Cards (solid value; glass is layered on top) |
| `--panel-2` | `#0C1320` | `#F4F7FB` | Insets, inputs, table hover |
| `--line` | hairline, `rgba(148,178,214,.14)` | `#D5DEEA` | Borders |
| `--text` | `#E6EDF7` | `#0E1726` | Body text |
| `--muted` | `#8EA0BA` | `#52627A` | Secondary text |
| `--accent` | `#3DDCCB` | `#086A61` | Signal teal: section labels, values, active bar |
| `--accent-2` | `#6CB8FF` | `#1D5FD8` | Action blue: primary buttons, active states, focus |
| `--accent-ink` | `#041018` | `#FFFFFF` | Text on accent fills |
| `--good` | `#5BE49B` | `#12643A` | OK |
| `--warn` | `#F7C04A` | `#8A3B0B` | Warning |
| `--bad` | `#FF7A8A` | `#B01C2E` | Fault |

Phase colours keep their meaning (A orange, B blue, C green), slightly brightened in dark mode.
`chartTheme.js` palettes are updated to the same values.

Measured contrast (lowest of bg/panel/panel-2): dark — text 15.1, muted 6.7, accent 10.4,
accent-2 8.4, warn 10.7, bad 7.1, good 11.0; light — text 16.0, muted 5.5, accent 5.8,
accent-2 5.1, warn 6.9, bad 6.1, good 6.4. On own pill: light accent 5.2 (the lowest value).
Button text: dark 9.1, light 5.7.

### 4.2 Depth

One light source from the top-left, applied consistently.

- Elevation tokens `--elev-0` (page), `--elev-1` (card), `--elev-2` (hover/raised), `--elev-3`
  (floating: palette, drawers, menus). Each is a stack of soft shadows plus a 1 px top highlight.
- Cards: frosted glass (`backdrop-filter: blur() saturate()`) over the background, at least 72%
  opaque, with a faint inner sheen gradient. Without `backdrop-filter` support, or at phone widths (≤720 px), cards are
  solid `--panel`. The top bar and drawers keep glass on phones.
- Stat tiles: pointer-tracked tilt, at most 3°, and a faint glow in their status colour on hover.
  Disabled for touch input (`hover: none`) and reduced motion.
- Background: a faint 24 px engineering grid plus a soft radial light behind the content.

### 4.3 Type, shape, spacing

- Fonts unchanged: Space Grotesk (display), Inter (body), IBM Plex Mono (numbers, labels).
- `font-variant-numeric: tabular-nums` on numbers so changing values don't jitter.
- Scale: page title 24 px, card title 15 px, body 14 px, section labels 11 px mono capitals.
- Radius tokens 6 / 10 / 14 / 20 px. Spacing on a 4 px grid, as tokens.

## 5. App shell

### 5.1 Navigation model

`client/src/lib/nav.js` exports the groups, the single source for the sidebar and the palette:

- Build: Setup, Network, Diagram, Map
- Analyse: Run & Reports, 24h Profile, Charts, Protection, Probabilistic, Scenarios
- Optimise: Solar Hosting, BESS Hosting, Feeder Split, Load Balance, Reconductor, Fix-it Ladder
- Field: Field data, Field survey
- Workspace: Dashboard, Designs, AI Insights, About

That is exactly today's 22 tabs. Labels are the existing English strings, translated with `t()`.
The Wizard is not in the sidebar but is searchable in the palette.

### 5.2 Sidebar (`components/Sidebar.jsx`)

- 248 px expanded, 64 px collapsed (icons only, labels as tooltips). Toggle button; the state is
  remembered in `localStorage` (wrapped in try/catch, as `ThemeContext` does).
- Group labels in mono capitals; items with an icon and label.
- Active item: a lit teal bar that slides between items.
- Icons: a small set of inline SVG line icons in `components/icons.jsx` (1.5 px stroke, 20 px,
  `currentColor`, `aria-hidden`). No icon library.
- At ≤720 px: an off-canvas drawer opened by a menu button in the top bar. It closes on navigation
  and on Escape, traps focus while open and returns focus to the menu button.
- Landmark: `<nav aria-label="Main navigation">` (existing translated label).

### 5.3 Top bar (`components/TopBar.jsx`)

- `<header class="top">`, slim, sticky, glass.
- Left: phone menu button; the design name and the transformer count / kVA summary (moved from
  today's brand block).
- Centre: a search field button, "Search pages and actions… Ctrl K", that opens the palette.
- Right: Undo and Redo icon buttons with tooltips (existing Ctrl/⌘+Z handling unchanged), theme
  toggle, language select, user menu (email, Sign out).
- The machine-draft translation banner stays, full width under the bar.
- Skip link stays first in the tab order; `<main id="main" tabIndex={-1}>` stays.

### 5.4 Command palette (`components/CommandPalette.jsx`)

- Opens with Ctrl+K / ⌘K or the top-bar search button; modal dialog over a dimmed, blurred
  backdrop.
- Searches all pages (the 22 plus Wizard) by their translated label, showing each page's group.
  Actions: switch theme, undo, redo, sign out.
- Matching is a pure function in `lib/paletteSearch.js` (case- and accent-insensitive subsequence
  match, ranked: prefix > word start > subsequence), unit tested.
- Accessibility: `role="dialog"` with `aria-modal`, an input with `role="combobox"` controlling a
  `role="listbox"`; `aria-activedescendant` for the highlighted option; Arrow keys, Enter, Escape;
  focus returns to the element that opened it.

### 5.5 Page header (`components/PageHeader.jsx`)

Title, a one-line description and an actions slot. Pages adopt it with a small change where they
already render a title; no page is rewritten.

### 5.6 Shell assembly

`components/AppShell.jsx` lays out sidebar, top bar and main area, owns the palette and the
phone-drawer state, and keys the page container on the route for the entrance animation.
`App.jsx`'s `ProtectedShell` uses `AppShell` instead of `TopNav`; `TopNav.jsx` is removed.

## 6. Components, charts, map, diagram

### 6.1 Shared classes (restyled in place, so every page inherits them)

- `.card`: `--elev-1`, glass and sheen, radius 14, title row with room for actions.
- `.stat`: instrument readout, with a large tabular value, smaller unit, a thin status rail on the
  left, and hover glow and tilt. Status variants `.ok`, `.warn` and `.bad` stay.
- Buttons: `button.primary` is a lit fill with a top highlight and presses 1 px. `button.ghost`,
  `button.mini` and `.iconbtn` share a family style. All have the glowing focus ring.
- Inputs and selects: recessed wells with a soft focus glow; mono font kept for numbers.
- Tables: sticky header inside `.tbl-wrap`, hairline rows, soft row-hover light, tabular digits.
  `tr.selected` keeps its left bar plus tint (not colour alone).
- `.pill`: a status dot plus text.
- `.badge-year`, `.wizard-steps`, `.overlay-toggles`: segmented-control style.
- `.issues-fab`, `.issues-drawer`, `.explain-drawer`, `.explain-backdrop`: floating level with
  glass; drawers slide in from the right; the backdrop dims and blurs.
- `.task-progress` gets a light sweep on the indeterminate bar. `.spinner` becomes a thin arc.
- `.note`, `.section-title`, `.error-banner` and `.draft-banner` are restyled to the tokens.
- Login and Register (`.authwrap`): a full-screen grid with soft light; the form sits on a floating
  glass panel with a slight 3D perspective tilt. Fields are unchanged.

### 6.2 Charts (Chart.js)

- `chartTheme.js` palettes updated to section 4.1.
- One shared place applies Chart.js defaults: fonts, 1.75 px lines, points hidden until hover,
  glass-style tooltips, and a faint gradient fill under single-series line charts. No chart page
  is rewritten.

### 6.3 Map (Leaflet)

Rounded frame, restyled zoom/attribution controls, markers (`.map-node`, `.map-tx`, `.map-cust`)
matched to the new pills. In dark mode the tile layer is dimmed and tinted with a CSS filter;
node labels drawn on top keep full contrast.

### 6.4 Single-line diagram

The 4 colours in `lib/sld/svg.js` move to theme variables for on-screen rendering. Symbols, line
meanings and the SVG/DXF export output are unchanged (the existing `sld.test.js` must stay green).

### 6.5 Polish pass

Inline styles that fight the new look (hard-coded header font sizes, ad-hoc borders, the 3 fixed
colours in JSX) move to classes on the most-used pages: Setup, Network, Diagram, Reports,
Dashboard and the advisor pages (Hosting, BESS Hosting, Feeder Split, Load Balance, Reconductor,
Fix-it). Other inline styles inherit the tokens and are left alone.

## 7. Motion

### 7.1 Tokens

- Durations: `--dur-1` 120 ms (hover, press), `--dur-2` 200 ms (menus, palette, tooltips,
  sidebar, leaving), `--dur-3` 280 ms (panels, drawers, page entrance), `--dur-data` 400 ms
  (numbers counting to new results).
- Easing: `--ease-out` `cubic-bezier(.22,1,.36,1)` for entering; `--ease-in`
  `cubic-bezier(.55,0,1,.45)` for leaving (and leaving is shorter); `--ease-move`
  `cubic-bezier(.65,0,.35,1)` for things moving between positions.

### 7.2 Catalogue

| Moment | Motion |
|---|---|
| Page change | Page container fades in and rises 6 px (`--dur-3`). Shell stays still. No exit animation (navigation stays instant). |
| Results update | `<Readout>` counts from the old to the new value (`--dur-data`, `--ease-out`) with a teal glow that fades over 600 ms. |
| Sidebar | Active bar slides (`--ease-move`, `--dur-2`); collapse animates the width (`--dur-2`); phone drawer slides in (`--dur-3`) and out (`--dur-2`). |
| Ctrl+K | Backdrop fades; the dialog fades and scales from 0.98 to 1 (`--dur-2`). The result list updates instantly. |
| Cards, tiles | Hover lift 2 px with `--elev-2` (`--dur-1`); tiles tilt toward the pointer (≤3°). |
| Buttons | Press translateY 1 px (`--dur-1`). |
| Drawers | Slide from the right (`--dur-3` in, `--dur-2` out); backdrop dims and blurs. |
| Loading | Suspense fallback becomes skeleton blocks with a soft light sweep. |

### 7.3 Rules

- Animate only `transform`, `opacity` and `filter`. Every animation is interruptible and never
  blocks input. No staggered entrances, no moving background.
- `prefers-reduced-motion: reduce`: all durations become 0, no tilt, `<Readout>` jumps to the
  final value. The existing reduced-motion rule for the progress bar stays.
- `<Readout value={number} format={fn} />` (`components/Readout.jsx`) is used on the main result
  pages. The easing/interpolation is a pure function in `lib/countUp.js`, unit tested. Other stat
  tiles stay static.
- Tilt is a small hook (`hooks/useTilt.js`) that sets CSS variables on pointer move, throttled with
  `requestAnimationFrame`.

## 8. Accessibility

- axe-core, WCAG 2.1 A and AA: 0 violations on all 22 pages in both themes.
- Keyboard: sidebar, phone drawer, palette and drawers fully operable; visible focus everywhere;
  Escape closes overlays; focus returns afterwards.
- 390 px: no horizontal page scroll on any page.
- Reduced motion fully respected (section 7.3).
- Status is never shown by colour alone (pill dots plus text; selected-row bar).

## 9. Print

`@media print`: light tokens on white regardless of theme; no shadows, glass, grid or animations;
sidebar, top bar, issues button and drawers hidden; cards avoid page breaks inside where possible.
The printable report must look at least as good as today.

## 10. Testing and verification

- Existing: `npm test` (Vitest), `npm run lint`, `npm run typecheck`, `npm run build` all pass.
  The i18n test enforces new keys in `en.json`, `si.json` and `ta.json`.
- New unit tests:
  - `nav.js`: every `/app/*` route except Wizard is in exactly one group; the 22 entries match
    today's tab list.
  - `paletteSearch.js`: ranking and accent/case-insensitivity.
  - `countUp.js`: endpoints, monotonic easing, and reduced motion returning the final value.
- Browser checks (Chrome DevTools MCP, dev server):
  - Screenshots of Setup, Network, Diagram, Reports, Dashboard, Charts, Map and Login in both
    themes, at 1440 px and 390 px.
  - axe-core run on all 22 pages in both themes.
  - Horizontal-scroll check at 390 px.
  - Keyboard walk-through of the sidebar, palette and drawers.
  - Lighthouse performance on Dashboard and Reports, compared with `main`.
  - Print preview of the report.

## 11. Rollout

Branch `ui-redesign-stage1`, one commit per area so each can be reverted alone:

1. Design tokens and base styles
2. App shell (nav model, sidebar, top bar, palette, page header)
3. Shared components restyle
4. Charts, map and diagram theming
5. Motion system (Readout, tilt, page entrance, skeletons)
6. Print styles
7. Polish pass on the main pages
8. Verification fixes

No engine or server changes. `main` is untouched until you decide to merge.

## 12. Risks

| Risk | Mitigation |
|---|---|
| `backdrop-filter` is slow on low-end phones | Solid cards at ≤720 px; glass only on top bar and drawers there |
| Glass lowers text contrast over busy backgrounds | Glass panels are at least 72% opaque over a faint grid; contrast checked against the solid panel value and re-verified with axe |
| Removing `TopNav` breaks something that queries it | Only `SetupPage` queries `header.top`; the new top bar keeps that selector and stays sticky |
| Dark-mode map tiles look odd | Filter tuned once; labels on top unaffected; can be turned off with one rule |
| Large diff across many files | Most change is in `styles.css` and new shell files; the polish pass is limited to the listed pages |
