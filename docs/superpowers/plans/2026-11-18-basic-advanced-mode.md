# Basic and Advanced modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Basic / Advanced switch (Basic by default) that hides advanced pages and Setup cards and adds a plain-language "What this means" card to Run & Reports.

**Architecture:** A `ModeContext` like `ThemeContext` holds the mode in `localStorage`. `lib/nav.js` flags the Basic pages and exposes `navGroupsFor(mode)`, used by the sidebar and the command palette. Setup and Run & Reports read the mode and hide or add cards. The engine is untouched.

**Tech Stack:** React 18, react-router 6, Vite, Vitest (Node environment, no jsdom).

**Spec:** `docs/superpowers/specs/2026-11-18-basic-advanced-mode-design.md`

## Global Constraints

- Mode values `'basic' | 'advanced'`; `localStorage` key `fi-mode`; default `'basic'` when nothing valid is stored or storage throws.
- Basic pages (14): `wizard, setup, network, map, diagram, reports, daily, hosting, fix-it, field-survey, dashboard, designs, insights, about`.
- Routes are never removed; hidden pages still open by URL or link.
- Every literal `t('…')` key must be in `client/src/i18n/en.json` (value = key), and `si.json` / `ta.json` must have exactly the same keys (machine drafts).
- No em-dashes in new UI copy.

## Review Focus

- "Suggest fix" in the Issues panel opens `/app/setup?section=conductors` or `?section=fault` while in Basic: the section must be on the page (Setup shows everything when `section` is set). Task 3, checked in the browser.
- `localStorage` blocked or holding a junk value: the app opens in Basic without throwing. Task 1, `parseMode` test.
- Results left in context from an earlier run (slider moved since): the card names the hour the run used (`res.hour`), not the slider. Task 4 test.
- Several phases violating on one pole: counted as one pole. Task 4 test.
- Two transformers overloaded: each named by its transformer name. Task 4 test.

---

### Task 1: Mode state and the top-bar switch

**Files:**
- Create: `client/src/lib/mode.js`, `client/src/context/ModeContext.jsx`
- Modify: `client/src/App.jsx` (wrap in `ModeProvider` inside `ThemeProvider`), `client/src/components/TopBar.jsx`, `client/src/i18n/{en,si,ta}.json`
- Test: `client/src/lib/__tests__/mode.test.js`

**Interfaces:**
- Produces: `parseMode(stored: unknown): 'basic' | 'advanced'` in `lib/mode.js`; `MODE_KEY = 'fi-mode'`; `useMode(): { mode, setMode(m) }` from `ModeContext.jsx`.

- [ ] **Step 1: Write the failing test** `parseMode`: `'advanced'` gives `'advanced'`; `'basic'`, `null`, `undefined`, `'Advanced'`, `'x'` give `'basic'`.
- [ ] **Step 2: Run** `cd client && npx vitest run src/lib/__tests__/mode.test.js`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `parseMode` and `ModeProvider` (initial state `parseMode(localStorage.getItem(MODE_KEY))` in try/catch, falling back to `'basic'`; persist on change in try/catch, as `ThemeContext` does).
- [ ] **Step 4: Switch in `TopBar`:** a `.segmented` group (`role="group"`, `aria-label={t('Mode')}`) with two buttons `t('Basic')`, `t('Advanced')`, class `on` and `aria-pressed` on the active one, placed before the undo button. Add keys `Mode`, `Basic`, `Advanced` to en/si/ta (si: ප්‍රකාරය, මූලික, උසස්; ta: பயன்முறை, அடிப்படை, மேம்பட்ட).
- [ ] **Step 5: Run** `cd client && npx vitest run src/lib/__tests__/mode.test.js src/lib/__tests__/i18n.test.js`. Expected: PASS.

### Task 2: Basic pages in the sidebar and the palette

**Files:**
- Modify: `client/src/lib/nav.js`, `client/src/components/Sidebar.jsx`, `client/src/components/AppShell.jsx`
- Test: `client/src/lib/__tests__/nav.test.js`

**Interfaces:**
- Consumes: `useMode()` (Task 1).
- Produces: each nav item may carry `basic: true`; `navGroupsFor(mode): NAV_GROUPS-shaped array` (Advanced: `NAV_GROUPS` itself; Basic: only `basic` items, empty groups dropped). `EXTRA_ITEMS` is deleted: the wizard becomes the first Build item `{ path: 'wizard', label: 'New design wizard', icon: 'wand', desc: 'Build a new network step by step', basic: true }`.

- [ ] **Step 1: Update the tests:** 24 nav items (old tabs + validation + wizard), group sizes `[5, 6, 6, 2, 5]`; routes in App.jsx equal `NAV_ITEMS` paths; `findNavItem('/app/wizard').group.id === 'build'`; `navGroupsFor('advanced') === NAV_GROUPS`; `navGroupsFor('basic')` paths flattened equal the 14 Basic pages from Global Constraints, in sidebar order, group ids `['build', 'analyse', 'optimise', 'field', 'workspace']`. Drop `EXTRA_ITEMS` from the label test.
- [ ] **Step 2: Run** `cd client && npx vitest run src/lib/__tests__/nav.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the flags, the wizard move, `navGroupsFor`, and remove `EXTRA_ITEMS` and its branch in `findNavItem`.
- [ ] **Step 4: Use it:** `Sidebar` maps `navGroupsFor(mode)`; `AppShell` builds palette pages from `navGroupsFor(mode)` (add `mode` to the `useMemo` deps) and drops `EXTRA_ITEMS`.
- [ ] **Step 5: Run** `cd client && npx vitest run src/lib/__tests__/nav.test.js`. Expected: PASS.

### Task 3: Setup in Basic

**Files:**
- Modify: `client/src/pages/SetupPage.jsx`

**Interfaces:**
- Consumes: `useMode()` (Task 1).

- [ ] **Step 1: Implement** `const full = mode === 'advanced' || !!section;` (a `?section=` deep link always shows the full page, so Issues-panel links land on their section). When `!full`, hide: the HV voltage profile `<details>` in each transformer card; the Tap advisor and the no-load loss table; the ZIP card; `StandardsCard`; the BESS assumptions card; everything from `InverterCard` to the end of the daily curves. Keep the design-name card, transformer cards, Customer load assumptions and Connection caps.
- [ ] **Step 2: Check in the browser** (Task 5): Basic Setup shows exactly those four parts; `/app/setup?section=fault` in Basic scrolls to the fault section.

### Task 4: "What this means" on Run & Reports

**Files:**
- Create: `client/src/lib/plainSummary.js`
- Modify: `client/src/pages/ReportsPage.jsx`
- Test: `client/src/lib/__tests__/plainSummary.test.js`

**Interfaces:**
- Consumes: `useMode()` (Task 1); the snapshot result `res` (`res.violations: { pole, phase, type, value }[]` with `type` in `undervoltage | overvoltage | thermal | transformer overload | unbalance`, `value` in V or %; `res.hour`; `res.transformers: { id, name }[]`).
- Produces: `plainSummary(res): { ok: boolean, lines: { text: string, to: string|null, linkLabel: string|null }[] }`.

- [ ] **Step 1: Write the failing tests:**
  - no violations, `hour: 20` gives `ok: true`, one line `'All customers are within limits at 20:00.'`, `to: null`.
  - undervoltage at P12 A (205.3) and B (207), P14 A (210), hour 20: one line `'Voltage is too low at 2 poles at 20:00. Worst: P12 (205 V).'`, `to: '/app/fix-it'`, `linkLabel: 'Try the Fix-it Ladder'`.
  - one overvoltage at P3 (254.6), hour 12: `'Voltage is too high at 1 pole at 12:00. Worst: P3 (255 V).'`, `to: '/app/fix-it'`.
  - thermal at P7 (134.2) and P8 (101): `'Cables are overloaded on 2 spans. Worst: the span to P7 (134 % of rating).'`, `to: '/app/reconductor'`, `linkLabel: 'See Reconductor'`.
  - transformer overload on TX1 (112.4) and TX2 (101) with names `'North'`, `'South'`: lines `'Transformer North is overloaded (112 %).'` and `'Transformer South is overloaded (101 %).'`, `to: '/app/feeder-split'`, `linkLabel: 'See Feeder Split'`.
  - unbalance at P5 (2.6): `'Voltage unbalance is over the limit at 1 pole.'`, `to: '/app/load-balance'`, `linkLabel: 'See Load Balance'`.
  - lines appear in the order low voltage, high voltage, cables, transformers, unbalance; `ok: false` whenever there is a line with a link.
- [ ] **Step 2: Run** `cd client && npx vitest run src/lib/__tests__/plainSummary.test.js`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `plainSummary` in `lib/plainSummary.js` (group by type, count distinct poles, worst = min V for under, max for the rest, round to whole numbers, `hh:00` from `res.hour`).
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Wire it in `ReportsPage`:** in Basic, above `<Report>`, a card `<h2>What this means</h2>` listing `lines` (each with a react-router `<Link to>` when `to` is set), class `stat ok`/`bad` styling via existing `.note` or `.card`; hide `<OpenDssCheck>` in Basic. Advanced unchanged.

### Task 5: Verify

- [ ] **Step 1:** `cd client && npm test` (all pass), `npm run lint` (clean), `npm run build` (succeeds).
- [ ] **Step 2: Browser check** with `npm run dev` and the server: first load opens in Basic with 14 sidebar items; clicking Advanced shows all 24 at once and survives a reload; palette search for "Protection" finds nothing in Basic and finds it in Advanced; Basic Setup and the deep link behave as in Task 3; Run & Reports in Basic shows the card after a run and no OpenDSS card; light and dark themes; phone width (switch fits the top bar without horizontal scroll).
