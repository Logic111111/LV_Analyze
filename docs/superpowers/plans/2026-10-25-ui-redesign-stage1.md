# UI Redesign Stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Feeder Island client a "precision instrument" design system, a grouped sidebar with a Ctrl/⌘+K palette, depth and purposeful motion. No new libraries, no engine changes.

**Architecture:** `client/src/styles.css` becomes a token-driven design system (colour, elevation, glass, radius, spacing, motion). Every page already uses its shared class names, so all pages inherit it. A new shell (`AppShell`, `Sidebar`, `TopBar`, `CommandPalette`, `PageHeader`) replaces `TopNav`. Pure logic (navigation model, palette search, count-up, tilt maths) lives in `src/lib/*.js` with Node unit tests. Browser behaviour is verified with Chrome DevTools in Task 10.

**Tech Stack:** React 18, React Router 6 (`<Routes>`), Vite 5, Vitest 2 (Node environment only), Chart.js 4, Leaflet 1.9, plain CSS custom properties.

**Spec:** `docs/superpowers/specs/2026-10-25-ui-redesign-stage1-design.md`

## Global Constraints

- `client/package.json` `dependencies` stay exactly as they are. No new runtime libraries.
- `packages/engine/` and `server/` are not touched. No calculation result may change.
- Colour tokens are exactly the values in spec section 4.1. Every text colour meets 4.5:1 on `--bg`, `--panel` and `--panel-2`, and status colours meet 4.5:1 on their own 14% pill.
- Every new literal `t('…')` key is added to `src/i18n/en.json` (value equals key), and the same key goes to `si.json` and `ta.json` as a machine-draft translation. `npm test` enforces this.
- Every `localStorage` access is wrapped in `try/catch`, as `ThemeContext.jsx` does.
- Animate only `transform`, `opacity` and `filter`. Under `prefers-reduced-motion: reduce`, every animation is instant.
- Motion tokens: `--dur-1:120ms; --dur-2:200ms; --dur-3:280ms; --dur-data:400ms; --ease-out:cubic-bezier(.22,1,.36,1); --ease-in:cubic-bezier(.55,0,1,.45); --ease-move:cubic-bezier(.65,0,.35,1)`.
- The phone breakpoint is `max-width: 720px`. Cards are solid (no `backdrop-filter`) at or below it.
- A sticky `<header class="top">` must exist. `pages/SetupPage.jsx` reads its height.
- The light palettes in `lib/sld/svg.js` and `lib/diagram.js` stay unchanged, because exports use them.
- Unit tests are Node-only: `src/**/__tests__/**/*.test.js`, with no JSX imports. Logic under test goes in `.js` files.
- Commits use the repo's short style (`UI stage 1: …`) with **no** `Co-Authored-By` trailer (user preference).
- Run commands from `client/` unless a step says otherwise.

## Review Focus

1. **Palette search in Sinhala or Tamil:** a query typed in the current language must find its translated page names, and the English names must still match. Removing accents must not strip the vowel signs those scripts use. Test in Task 3.
2. **Escape with two overlays open** (palette over the Issues drawer or the Explain drawer): Escape closes only the top one. Browser check in Task 3 / Task 10.
3. **A Readout given `null`, `NaN`, `undefined` or `Infinity`:** shows the fallback, never animates, never throws. A new value arriving mid-animation continues from the number currently shown. Tests in Task 6.
4. **Phone drawer open, then the window widens past 720 px** (rotation): the drawer closes, focus is released and the desktop sidebar shows. Browser check in Task 2 / Task 10.
5. **A route that is not one of the 22 sidebar pages** (`/app/wizard`, redirects): no crash. The Wizard gets its own header, and no sidebar item looks active. Test in Task 2 (`findNavItem`), browser check in Task 10.

---

### Task 1: Design tokens and base styles

**Files:**
- Modify: `client/src/styles.css:1-33` (tokens, base, header/brand rules), plus the reduced-motion block at the end
- Modify: `client/index.html:8` (`theme-color`), `client/public/manifest.webmanifest:9-10`
- Create: `client/src/lib/__tests__/contrast.test.js`

**Interfaces:**
- Produces CSS custom properties used by every later task:
  - **Colours:** `--bg --panel --panel-2 --line --text --muted --accent --accent-2 --accent-ink --good --warn --bad`
  - **Depth:** `--elev-1 --elev-2 --elev-3 --glass --glass-blur --grid-line --halo`
  - **Shape and spacing:** `--r-1..--r-4`, `--s-1..--s-8`
  - **Motion:** the motion tokens
  - **Fonts:** `--mono --disp --body`, unchanged

- [ ] **Step 1: Write the failing contrast test**

`contrast.test.js` reads `src/styles.css` and takes the hex `--name:#xxxxxx` declarations from the first `:root{…}` block (light) and from `:root[data-theme='dark']{…}`. It computes WCAG 2.1 contrast, alpha-blending pills over `--panel` at 0.14, and asserts:

```js
for (const theme of ['light', 'dark']) {
  for (const fg of ['text','muted','accent','accent-2','good','warn','bad'])
    for (const bg of ['bg','panel','panel-2']) expect(ratio(T[theme][fg], T[theme][bg])).toBeGreaterThanOrEqual(4.5);
  for (const s of ['accent','good','warn','bad']) expect(ratio(T[theme][s], blend(T[theme][s], T[theme].panel, 0.14))).toBeGreaterThanOrEqual(4.5);
  for (const a of ['accent','accent-2']) expect(ratio(T[theme]['accent-ink'], T[theme][a])).toBeGreaterThanOrEqual(4.5);
}
expect(T.light.accent).toBe('#086A61'); expect(T.dark.bg).toBe('#070B12');
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/lib/__tests__/contrast.test.js`
Expected: FAIL on `expect(T.light.accent).toBe('#086A61')`. The current value is `#0F766E`.

- [ ] **Step 3: Rewrite the token blocks and base styles in `styles.css`**

Colours: exactly spec 4.1. `--line` is dark `rgba(148,178,214,.14)` and light `#D5DEEA`. The test skips non-hex values. Then:

- `--glass`: dark `rgba(16,24,39,.78)`, light `rgba(255,255,255,.80)`.
- `--glass-blur`: `blur(14px) saturate(140%)`.
- `--grid-line`: dark `rgba(148,178,214,.045)`, light `rgba(15,23,42,.035)`.
- `--halo`:
  - dark: `radial-gradient(1200px 600px at 20% -10%, rgba(61,220,203,.08), transparent 60%)`
  - light: the same with `rgba(29,95,216,.06)`
- **Elevation, dark:**
  - `--elev-1: inset 0 1px 0 rgba(255,255,255,.05), 0 1px 2px rgba(0,0,0,.5), 0 12px 32px -16px rgba(0,0,0,.7)`
  - `--elev-2: inset 0 1px 0 rgba(255,255,255,.07), 0 2px 4px rgba(0,0,0,.5), 0 20px 44px -18px rgba(0,0,0,.8)`
  - `--elev-3: inset 0 1px 0 rgba(255,255,255,.08), 0 8px 16px rgba(0,0,0,.45), 0 32px 64px -24px rgba(0,0,0,.85)`
- **Elevation, light:**
  - `--elev-1: inset 0 1px 0 rgba(255,255,255,.9), 0 1px 2px rgba(15,23,42,.06), 0 10px 28px -14px rgba(15,23,42,.18)`
  - `--elev-2: inset 0 1px 0 rgba(255,255,255,.9), 0 2px 4px rgba(15,23,42,.08), 0 18px 40px -16px rgba(15,23,42,.24)`
  - `--elev-3: 0 8px 20px rgba(15,23,42,.12), 0 30px 60px -20px rgba(15,23,42,.30)`
- Radius `--r-1:6px --r-2:10px --r-3:14px --r-4:20px`. Spacing `--s-1:4px`, then `--s-2` 8, `--s-3` 12, `--s-4` 16, `--s-5` 20, `--s-6` 24, `--s-8` 32 (px).
- Motion tokens as in Global Constraints.
- `body`: `background: var(--halo), linear-gradient(var(--grid-line) 1px, transparent 1px) 0 0/24px 24px, linear-gradient(90deg, var(--grid-line) 1px, transparent 1px) 0 0/24px 24px, var(--bg)`, plus `background-attachment: fixed`.
- Numbers: `font-variant-numeric: tabular-nums` on `td, .stat .v, .readout, input[type=number]`.
- Type scale: `h1` 24px/600, `.card h2` 15px, body 14px.
- Phase colours, dark: `.phaseA #FFA27F`, `.phaseB #6AA6FF`, `.phaseC #5BE49B`. Light is unchanged.
- At the end, add a global block: `@media (prefers-reduced-motion: reduce){*,*::before,*::after{animation-duration:0s!important;animation-iteration-count:1!important;transition-duration:0s!important}}`. Keep the existing progress-bar rule.
- Leave every other existing selector in place. Later tasks restyle them.

- [ ] **Step 4: Update the browser chrome colour**

`index.html` `theme-color`, and the manifest's `background_color` and `theme_color`, become `#070B12`.

- [ ] **Step 5: Run the checks**

Run: `npx vitest run src/lib/__tests__/contrast.test.js && npm run lint && npm run build`
Expected: the test PASSES, lint is clean, the build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/styles.css src/lib/__tests__/contrast.test.js index.html public/manifest.webmanifest
git commit -m "UI stage 1: design tokens, depth, grid background, contrast test"
```

---

### Task 2: Navigation model and app shell (sidebar, top bar, page header)

**Files:**
- Create: `client/src/lib/nav.js`, `client/src/lib/__tests__/nav.test.js`
- Create: `client/src/components/icons.jsx`, `Sidebar.jsx`, `TopBar.jsx`, `PageHeader.jsx`, `AppShell.jsx`
- Create: `client/src/hooks/useFocusTrap.js`
- Modify: `client/src/App.jsx:7,44-79` (use `AppShell`)
- Delete: `client/src/components/TopNav.jsx`
- Modify: `client/src/styles.css` (shell section, replacing the `header.top`/`.brand`/`nav.tabs` rules)
- Modify: `client/src/i18n/en.json`, `si.json`, `ta.json`

**Interfaces:**
- Produces in `lib/nav.js` (plain JS, no JSX):
  - `NAV_GROUPS: Array<{ id: string, label: string, items: NavItem[] }>`, where `NavItem = { path: string, label: string, icon: string, desc: string }`
  - `NAV_ITEMS: Array<NavItem & { group: string }>`, flattened in group order
  - `EXTRA_ITEMS: NavItem[]`, which is `[{ path: 'wizard', label: 'New design wizard', icon: 'wizard', desc: … }]`
  - `findNavItem(pathname: string): { item: NavItem, group: {id,label} | null } | null`. It matches `/app/<path>` and ignores a trailing slash and the query string. `wizard` returns `group: null`. Unknown paths return `null`.
- Produces `icons.jsx`: `Icon({ name: string, size?: number })`, an inline SVG with `aria-hidden="true"`, 1.5 px stroke, `currentColor`. Names: one per `NavItem.icon`, plus `menu, search, undo, redo, sun, moon, chevrons-left, chevrons-right, user, close`.
- Produces `useFocusTrap(containerRef, active: boolean): void`. While active, Tab and Shift+Tab cycle inside the container.
- Produces `AppShell({ children })`. It owns `sidebarCollapsed`, stored under `localStorage` key `fi-sidebar` as `'collapsed' | 'expanded'`, and `drawerOpen`. It renders `Sidebar`, `TopBar` and `<main id="main" tabIndex={-1}>` with a `PageHeader`, then `children`. Task 3 adds `paletteOpen`.
- Produces `TopBar({ onOpenMenu, onOpenPalette })` and `Sidebar({ collapsed, onToggleCollapsed, drawerOpen, onCloseDrawer })`.
- Produces `PageHeader({ eyebrow?: string, title: string, desc?: string, actions?: ReactNode })`, which renders `<h1>`.

- [ ] **Step 1: Write the failing nav tests (`nav.test.js`)**

```js
const OLD_TABS = ['setup','network','diagram','map','reports','daily','charts','hosting','bess-hosting','feeder-split','load-balance','reconductor','fix-it','monte-carlo','scenarios','field-data','field-survey','protection','insights','dashboard','designs','about'];
it('the 22 sidebar pages are exactly the old tabs, each in one group', () => {
  expect([...NAV_ITEMS.map(i => i.path)].sort()).toEqual([...OLD_TABS].sort());
  expect(new Set(NAV_ITEMS.map(i => i.path)).size).toBe(22);
  expect(NAV_GROUPS.map(g => g.id)).toEqual(['build','analyse','optimise','field','workspace']);
  expect(NAV_GROUPS.map(g => g.items.length)).toEqual([4, 6, 6, 2, 4]);
});
it('every nav path and the wizard is a route in App.jsx, and every App route is in nav or extra', () => {
  const routes = [...fs.readFileSync(appJsx, 'utf8').matchAll(/<Route path="([a-z-]+)"/g)].map(m => m[1]);
  expect(new Set(routes)).toEqual(new Set([...NAV_ITEMS, ...EXTRA_ITEMS].map(i => i.path)));
});
it('findNavItem', () => {
  expect(findNavItem('/app/network').item.label).toBe('Network');
  expect(findNavItem('/app/network/').group.id).toBe('build');
  expect(findNavItem('/app/setup?section=tx').item.path).toBe('setup');
  expect(findNavItem('/app/wizard')).toEqual({ item: EXTRA_ITEMS[0], group: null });
  expect(findNavItem('/app/nope')).toBeNull();
  expect(findNavItem('/login')).toBeNull();
});
it('labels and group names are translatable keys in en.json', () => {
  [...NAV_GROUPS.map(g => g.label), ...NAV_ITEMS.map(i => i.label), ...NAV_ITEMS.map(i => i.desc), EXTRA_ITEMS[0].desc]
    .forEach(k => expect(en[k]).toBe(k));
});
```

Group membership is as in spec 5.1. `appJsx` is `path.resolve(__dirname, '../../App.jsx')`.

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run src/lib/__tests__/nav.test.js`
Expected: FAIL, because `../nav.js` does not exist.

- [ ] **Step 3: Implement `lib/nav.js`**

Labels are the existing English strings from `TopNav.jsx`. Each `desc` is one short sentence, at most 70 characters, describing the page; take the wording from that page's existing intro hint. Groups as in spec 5.1.

- [ ] **Step 4: Add the dictionary entries**

Add to `en.json`, `si.json` and `ta.json`:
- **Group names:** `Build`, `Analyse`, `Optimise`, `Field`, `Workspace`
- **The 23 descriptions**
- **Shell labels:** `Collapse sidebar`, `Expand sidebar`, `Open menu`, `Close menu`, `Search pages and actions…`, `Account`

Sinhala and Tamil values are machine drafts. Placeholders: none.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run src/lib/__tests__/nav.test.js src/lib/__tests__/i18n.test.js`
Expected: PASS.

- [ ] **Step 6: Build the shell components**

**Sidebar:**
- Brand at the top: the existing `.mark` plus the text "Feeder Island" in a `<div className="brand-name">`, not a heading.
- Groups use `<h2 className="sidebar-group">` (visually small mono capitals), then `NavLink` items with `Icon` and label. When collapsed, the label is visually hidden and shown as a `title` tooltip.
- Inside `<nav aria-label={t('Main navigation')}>`.
- The active item gets the `.sidebar-indicator` bar.
- Collapse button at the foot, labelled `t('Collapse sidebar')` or `t('Expand sidebar')`.

**TopBar:**
- `<header className="top">`.
- **Left:** the menu button, `aria-label={t('Open menu')}`, shown only at ≤720 px. Then design name and summary, using the existing `{n} transformer(s)` and `{kva} kVA total` strings.
- **Centre:** `<button className="palette-trigger">` with the `search` icon, the text `t('Search pages and actions…')` and `<kbd>Ctrl K</kbd>`. It calls `onOpenPalette`.
- **Right:**
  - Undo and Redo icon buttons, keeping their `title` and `aria-label` and the `disabled` logic from `TopNav`.
  - Theme toggle (sun/moon icon, `aria-label` = `t('Light mode')` or `t('Dark mode')`).
  - The language `select`.
  - An account menu: a `<details className="account">` whose summary has `aria-label={t('Account')}`, holding the email and the Sign out button.
- The draft banner as before. The skip link renders before the shell.

**AppShell:**
- Layout grid `.shell`, with `.shell.collapsed` at 64 px.
- Below 720 px, the sidebar is off-canvas: `.sidebar.open` plus a `.sidebar-backdrop`. `useFocusTrap` is active while open.
- The drawer closes on route change, on Escape, on backdrop click, and when `matchMedia('(max-width: 720px)')` stops matching (Review Focus 4). When it closes, focus returns to the menu button.
- `PageHeader` gets `eyebrow={group && t(group.label)}`, `title={t(item.label)}`, `desc={t(item.desc)}` from `findNavItem(location.pathname)`. It renders nothing when that returns `null`.

**App.jsx:** `ProtectedShell` returns `<DesignProvider><AppShell><Suspense …><Routes>…</Routes></Suspense></AppShell><IssuesPanel /></DesignProvider>`. Remove the `TopNav` import and delete `TopNav.jsx`.

**CSS:**
- `.shell` grid. `.sidebar` is sticky and full height, `--glass` with `--glass-blur`. Sidebar width transitions over `--dur-2`.
- The indicator: `.sidebar-item.active::before`, a teal bar with `box-shadow: 0 0 12px var(--accent)`.
- `header.top` keeps `position: sticky; top: 0`, glass, height 56px.
- At ≤720 px, `header.top` stays **sticky**. The current `position: static` rule existed only because the tabs wrapped, and it is removed.
- `.page-header h1` 24px. The eyebrow is in `--accent`, mono, 11px capitals.

- [ ] **Step 7: Run all tests, lint and build**

Run: `npm test && npm run lint && npm run build`
Expected: all PASS. No `TopNav` imports remain: `git grep -n TopNav client/src` prints nothing.

- [ ] **Step 8: Browser check (dev server; see Task 10 for setup)**

- At 1440 px: the sidebar shows 5 groups and 22 items; the active item is lit; the collapse toggle survives a reload.
- At 390 px: the menu button opens the drawer, and Tab stays inside it. Widen the viewport to 1024 px while it is open: the drawer closes and focus is no longer trapped.
- On `/app/wizard` the header reads "New design wizard" and no item is active.
- `/app/setup?section=…` still scrolls the section clear of the sticky header.

- [ ] **Step 9: Commit**

```bash
git add -A src/lib/nav.js src/lib/__tests__/nav.test.js src/components src/hooks/useFocusTrap.js src/App.jsx src/styles.css src/i18n
git commit -m "UI stage 1: grouped sidebar, top bar, page header; retire TopNav"
```

---

### Task 3: Command palette (Ctrl/⌘+K)

**Files:**
- Create: `client/src/lib/paletteSearch.js`, `client/src/lib/__tests__/paletteSearch.test.js`
- Create: `client/src/components/CommandPalette.jsx`
- Modify: `client/src/components/AppShell.jsx` (palette state, shortcut, items), `TopBar.jsx` (trigger already wired)
- Modify: `client/src/styles.css` (palette section), `src/i18n/*.json`

**Interfaces:**
- Consumes: `NAV_GROUPS`, `NAV_ITEMS`, `EXTRA_ITEMS` (Task 2); `useFocusTrap` (Task 2).
- Produces in `lib/paletteSearch.js`:
  - `normalizeForSearch(s: string): string`: lower-case, NFD, then remove only U+0300–U+036F (Latin combining marks).
  - `matchScore(query: string, text: string): number`. Returns 3 for a prefix of `text`, 2 for the prefix of any word in `text`, 1 for an in-order subsequence, 0 for no match. Both arguments are normalised.
  - `searchPalette(query: string, items: PaletteItem[]): PaletteItem[]`, where `PaletteItem = { id: string, label: string, keywords: string[], group: string | null, kind: 'page' | 'action' }`. The score is the max over `label` and `keywords`. Items scoring 0 are dropped. Results are sorted by score, descending, with ties kept in input order. A blank query returns `items` unchanged.
- Produces `CommandPalette({ open: boolean, onClose: () => void, items: PaletteItem[], onSelect: (item) => void })`.

- [ ] **Step 1: Write the failing search tests**

```js
const items = [{id:'p:hosting',label:'Solar Hosting',keywords:[],group:'Optimise',kind:'page'}, {id:'p:bess',label:'BESS Hosting',keywords:[],group:'Optimise',kind:'page'}, {id:'p:fix',label:'Fix-it Ladder',keywords:[],group:'Optimise',kind:'page'}, {id:'p:net',label:si['Network'],keywords:['Network'],group:si['Build'],kind:'page'}];
expect(matchScore('sol', 'Solar Hosting')).toBe(3);
expect(matchScore('host', 'Solar Hosting')).toBe(2);
expect(matchScore('slh', 'Solar Hosting')).toBe(1);
expect(matchScore('xyz', 'Solar Hosting')).toBe(0);
expect(searchPalette('bess', items)[0].id).toBe('p:bess');
expect(searchPalette('HOSTING', items).map(i => i.id)).toEqual(['p:hosting', 'p:bess']);
expect(searchPalette('ladder', items)[0].id).toBe('p:fix');
expect(normalizeForSearch('Café')).toBe('cafe');
expect(normalizeForSearch(si['Network'])).toBe(si['Network'].normalize('NFD').toLowerCase());   // Sinhala vowel signs kept
expect(searchPalette(si['Network'].slice(0, 2), items)[0].id).toBe('p:net');                    // Review Focus 1
expect(searchPalette('network', items)[0].id).toBe('p:net');                                     // English keyword
expect(searchPalette('   ', items)).toBe(items);
expect(searchPalette('zzz', items)).toEqual([]);
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run src/lib/__tests__/paletteSearch.test.js`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `lib/paletteSearch.js`**

Run the Step 1 command. Expected: PASS.

- [ ] **Step 4: Build `CommandPalette` and wire it into `AppShell`**

**Items (built in AppShell):** every `NAV_ITEMS` and `EXTRA_ITEMS` entry as a page item, with `label: t(label)`, `keywords: [label]`, `group: t(group.label)`. Then four actions:
- Theme: label `t('Light mode')` or `t('Dark mode')`.
- `t('Undo')` and `t('Redo')`, omitted when unavailable.
- `t('Sign out')`.

Selecting a page navigates to it; selecting an action runs it. Either way the palette closes.

**Shortcut:** a window `keydown` with `(e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k'` calls `preventDefault()` and toggles the palette. It also works while typing in fields. When the palette opens, store `document.activeElement` and restore focus on close.

**Dialog structure:**
- `<div className="palette-backdrop">` containing `<div role="dialog" aria-modal="true" aria-label={t('Command palette')}>`.
- An `<input role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={'pal-opt-' + activeId}>`.
- `<ul id="palette-list" role="listbox">` whose options are `<li role="option" id={'pal-opt-' + id} aria-selected>`, each showing the label plus the group on the right.
- A `role="status"` line showing `t('No matches')` when there are no results.

**Keys** are handled in the dialog's own `onKeyDown`, not on `window`:
- ArrowDown and ArrowUp wrap round.
- Enter selects.
- Escape calls `e.stopPropagation()` and then `onClose` (Review Focus 2).

`useFocusTrap` is active while the palette is open.

**CSS:** the backdrop uses `rgba(0,0,0,.4)` and `backdrop-filter: blur(4px)`. The dialog is `min(640px, 100vw - 32px)` wide, top 12vh, `--elev-3`, glass. It enters over `--dur-2` with `--ease-out`, from `opacity:0; transform: scale(.98)`. The active option has `--panel-2` with an `--accent-2` left bar.

**i18n:** add `Command palette` and `No matches`.

- [ ] **Step 5: Run all tests, lint and build**

Run: `npm test && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 6: Browser check**

- Ctrl+K opens the palette, also from inside a numeric field.
- "rep" then Enter navigates to Run & Reports.
- In Sinhala, typing the start of a translated page name finds it.
- Open the Issues drawer, then Ctrl+K, then press Escape: only the palette closes. Press Escape again: the drawer closes.
- Focus returns to the element that had it.

- [ ] **Step 7: Commit**

```bash
git add src/lib/paletteSearch.js src/lib/__tests__/paletteSearch.test.js src/components/CommandPalette.jsx src/components/AppShell.jsx src/styles.css src/i18n
git commit -m "UI stage 1: Ctrl/Cmd+K command palette"
```

---

### Task 4: Shared components restyle

**Files:**
- Modify: `client/src/styles.css`, the rules for the classes listed in spec 6.1
- Modify: `client/src/pages/LoginPage.jsx:27-50`, `RegisterPage.jsx` (same structure)

**Interfaces:**
- Consumes: the Task 1 tokens.
- Produces these class contracts, relied on by Tasks 6 and 9:
  - `.card` (glass, `--elev-1`, `--r-3`).
  - `.stat` with `.v` and `.l`, plus a status rail via `::before` for `.ok`, `.warn` and `.bad`.
  - `.pill::before` (status dot).
  - `.segmented`, a new class shared by `.badge-year`, `.wizard-steps` and `.overlay-toggles`.
  - `.auth-scene` and `.auth-panel`.
  - `.hint.error`.

- [ ] **Step 1: Restyle per spec 6.1**

**Surfaces**
- `.card`: `background: var(--glass); backdrop-filter: var(--glass-blur); box-shadow: var(--elev-1); border: 1px solid var(--line); border-radius: var(--r-3)`, with an inner sheen from `linear-gradient(180deg, rgba(255,255,255,.03), transparent 40%)`. Under `@media (max-width:720px)` and `@supports not (backdrop-filter: blur(1px))` it becomes `background: var(--panel); backdrop-filter: none`.
- `.stat`: `--panel-2` background. A 3 px left rail in `--line`; for `.ok`, `.warn` and `.bad` the rail takes the status colour plus `box-shadow: 0 0 16px` of that colour at 35% on hover. `.v` is 22px mono.

**Controls**
- Buttons:
  - `button.primary`: `linear-gradient(180deg, color-mix(in srgb, var(--accent-2) 92%, white), var(--accent-2))`, a top highlight `inset 0 1px 0 rgba(255,255,255,.25)`, and `:active{transform:translateY(1px)}`.
  - Ghost, mini and icon buttons share a family style.
  - Focus ring for all buttons and inputs: `outline: 2px solid var(--accent-2); outline-offset: 2px; box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent-2) 25%, transparent)`.
- Inputs and selects: `--panel-2` with `box-shadow: inset 0 1px 2px rgba(0,0,0,.25)`.
- `.tbl-wrap th`: `position: sticky; top: 0; background: var(--panel); z-index: 1`. Row hover is `--panel-2`. Keep `tr.selected`.
- `.pill::before`: a 6 px `currentColor` dot with a 6 px right margin.
- `.badge-year`, `.wizard-steps` and `.overlay-toggles` share the `.segmented` look: `--panel-2` track, `--r-2` radius, an active segment in `--accent-2` with `--elev-1`. They are restyled through the CSS selectors; no markup changes.

**Overlays and feedback**
- `.issues-fab` gets `--elev-3`. `.issues-drawer` and `.explain-drawer` get glass and `--elev-3`. `.explain-backdrop` gets `backdrop-filter: blur(4px)`.
- `.task-progress-fill` and the indeterminate bar get a light sweep: an `::after` with a moving linear gradient via `@keyframes sweep`, 1.6 s.
- `.spinner` becomes a 2 px arc using `--accent`.
- `.note`, `.section-title`, `.error-banner` and `.draft-banner` use the tokens.
- `.hint.error { color: var(--bad) }`.

**Login and Register:** the markup becomes `<div className="auth-scene"><div className="auth-panel">…existing brand and card…</div></div>`.
- `.auth-scene` is full height with the grid and halo, plus a larger halo.
- `.auth-panel` is `perspective(1200px) rotateX(4deg) rotateY(-4deg)`, easing to `rotateX(0) rotateY(0)` on `:focus-within`, over `--dur-3`.
- Fields and logic are unchanged. Replace their inline `style` objects with classes: `.auth-brand`, and `.btn-block` for the full-width button.

- [ ] **Step 2: Run lint and build, then check in the browser**

Run: `npm run lint && npm run build`
Expected: PASS.

Then, in both themes: the Reports page cards and stats, a table with a sticky header, pills with dots, the year picker, the Issues drawer, Explain, and Login.

- [ ] **Step 3: Commit**

```bash
git add src/styles.css src/pages/LoginPage.jsx src/pages/RegisterPage.jsx
git commit -m "UI stage 1: restyle cards, readouts, controls, tables, drawers, sign-in"
```

---

### Task 5: Charts, map and diagram theming

**Files:**
- Modify: `client/src/lib/chartTheme.js:3-16`
- Create: `client/src/lib/chartDefaults.js`
- Modify: `client/src/components/ChartCanvas.jsx:1-2`, `client/src/components/LineChart.jsx:1-2` (import `../lib/chartDefaults.js` once)
- Modify: `client/src/lib/sld/svg.js:9-12` (dark only), `client/src/lib/diagram.js:52` (dark only)
- Modify: `client/src/pages/MapPage.jsx:134,138` (polyline colours, from the theme)
- Modify: `client/src/styles.css` (map section)

**Interfaces:**
- Produces `chartDefaults.js` as a side-effect module. It calls `Chart.defaults` changes and registers the plugin `fiAreaGradient` once.

- [ ] **Step 1: Chart palettes**

**Light:**
- `axisColor '#52627A'`, `gridColor '#E3E9F2'`, `legendColor '#0E1726'`
- `seriesColors ['#1D5FD8','#7C3AED','#12643A','#B01C2E']`
- `maxColor '#B01C2E'`, `minColor '#12643A'`
- Phase colours unchanged

**Dark:**
- `axisColor '#8EA0BA'`, `gridColor '#1A2638'`, `legendColor '#E6EDF7'`
- `seriesColors ['#6CB8FF','#B794FF','#5BE49B','#FF7A8A']`
- `maxColor '#FF7A8A'`, `minColor '#5BE49B'`
- `phaseColors {A:'#FFA27F', B:'#6AA6FF', C:'#5BE49B'}`

- [ ] **Step 2: Chart defaults (`chartDefaults.js`)**

- `Chart.defaults.font.family = "Inter, 'Segoe UI', sans-serif"`, size 11.
- `elements.line.borderWidth = 1.75`.
- `elements.point.radius = 0`, `hoverRadius = 4`.
- Tooltip:
  - `backgroundColor 'rgba(10,16,28,.92)'`, `borderColor 'rgba(148,178,214,.25)'`, `borderWidth 1`
  - `cornerRadius 8`, `padding 10`
  - `titleFont {family:"'IBM Plex Mono', monospace"}`
- Plugin `fiAreaGradient`, in `beforeDatasetsDraw`: only when `chart.config.type === 'line'`, there is exactly one dataset, and its `fill` is `undefined`. It sets `fill: 'origin'` and `backgroundColor` to a vertical canvas gradient from `borderColor` at 18% alpha to transparent. Apply it once per chart (track it with a WeakSet).

- [ ] **Step 3: Diagram palettes, dark only**

- **SLD:** `text '#E6EDF7'`, `muted '#8EA0BA'`, `ok '#5BE49B'`, `warn '#F7C04A'`, `bad '#FF7A8A'`, `phaseA '#FFA27F'`, `phaseB '#6AA6FF'`, `phaseC '#5BE49B'`, `bg '#101827'`. `line` and `accent` stay.
- **Diagram:** `nodeFill '#101827'`, `text '#E6EDF7'`, `muted '#8EA0BA'`, the same phases.

The light palettes are untouched.

- [ ] **Step 4: Map**

- Use `useTheme()` in `MapPage`. The spans polyline is `'#6CB8FF'` in dark and `'#1D5FD8'` in light. The open-point dash is `'#8EA0BA'` in dark and `'#52627A'` in light.
- Add `theme` to the dependencies of the effect that draws them.
- CSS: `.map-frame` gets `--r-3` and `--elev-1`. Leaflet controls get `.leaflet-bar a` in `--panel` / `--text`.
- `:root[data-theme='dark'] .map-frame .leaflet-tile-pane{filter:brightness(.75) saturate(.8) contrast(1.05)}`. Dim only, never invert, so a custom satellite tile URL still looks right.

- [ ] **Step 5: Run the checks**

Run: `npm test && npm run lint && npm run build`
Expected: PASS. `sld.test.js` still passes, since the light export palette is unchanged.

- [ ] **Step 6: Browser check**

- Charts page and 24h Profile in both themes: thin lines, hover points, glass tooltip, gradient on single-series charts.
- Map in dark mode: tiles dimmed; with a custom tile URL entered they are still legible.
- Diagram page dark: new colours.

- [ ] **Step 7: Commit**

```bash
git add src/lib/chartTheme.js src/lib/chartDefaults.js src/components/ChartCanvas.jsx src/components/LineChart.jsx src/lib/sld/svg.js src/lib/diagram.js src/pages/MapPage.jsx src/styles.css
git commit -m "UI stage 1: chart defaults and palettes, map and diagram dark theming"
```

---

### Task 6: Readout (results counting to new values)

**Files:**
- Create: `client/src/lib/countUp.js`, `client/src/lib/__tests__/countUp.test.js`
- Create: `client/src/components/Readout.jsx`
- Modify: the numeric `.stat .v` values in `client/src/pages/ReportsPage.jsx`, `DailyPage.jsx`, `BessHostingPage.jsx`

**Interfaces:**
- Produces in `countUp.js`:
  - `easeOutCubic(t: number): number`, defined as `1 - (1 - t) ** 3`, with `t` clamped to [0, 1].
  - `countUpValue(from: number, to: number, elapsedMs: number, durationMs = 400): number`. It returns `to` when `elapsedMs >= durationMs`, when `durationMs <= 0`, or when `from` or `to` is not finite. Otherwise it returns `from + (to - from) * easeOutCubic(elapsedMs / durationMs)`.
- Produces `Readout({ value: number | null | undefined, format: (v: number) => string, fallback = '—' })`. It renders `<span className="readout">`.

- [ ] **Step 1: Write the failing tests**

```js
expect(easeOutCubic(0)).toBe(0); expect(easeOutCubic(1)).toBe(1); expect(easeOutCubic(2)).toBe(1);
const s = [0,.1,.2,.4,.6,.8,1].map(easeOutCubic); s.slice(1).forEach((v, i) => expect(v).toBeGreaterThan(s[i]));
expect(countUpValue(10, 20, 0)).toBe(10);
expect(countUpValue(10, 20, 400)).toBe(20);
expect(countUpValue(10, 20, 200)).toBeGreaterThan(15);                 // ease-out runs ahead of linear
expect(countUpValue(20, 10, 200)).toBeLessThan(15);                    // downwards too
expect(countUpValue(NaN, 20, 100)).toBe(20);                           // Review Focus 3
expect(countUpValue(10, Infinity, 100)).toBe(Infinity);
expect(countUpValue(10, 20, 100, 0)).toBe(20);                         // reduced motion uses duration 0
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run src/lib/__tests__/countUp.test.js`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `countUp.js`**

Run the Step 1 command. Expected: PASS.

- [ ] **Step 4: Implement `Readout.jsx`**

- **Non-finite `value`:** render `fallback`. No animation, no timers.
- **First mount:** show `format(value)` immediately, with no count.
- **When `value` changes to a finite number:**
  - Animate with `requestAnimationFrame` from the currently displayed number, kept in a ref, which makes it interruptible (Review Focus 3).
  - Duration 400 ms. Under `matchMedia('(prefers-reduced-motion: reduce)')` use 0.
  - Add the class `changed` for 600 ms. CSS: `.readout.changed{animation: readout-glow 600ms var(--ease-out)}`, a `text-shadow` glow in `--accent` fading to none.
- Cancel the frame and the timer on unmount.
- The final text must equal `format(value)` exactly.

- [ ] **Step 5: Adopt it on the three pages**

Wrap only the numeric part, and keep units and text outside. Example from `ReportsPage.jsx:147`:

`<div className="v"><Readout value={totalSystemLossW / 1000} format={v => v.toFixed(2)} /> kW</div>`

Leave non-numeric values (labels, `vufText(...)`, the A/B/C phase spans) as they are.

- [ ] **Step 6: Run the checks, then check in the browser**

Run: `npm test && npm run lint && npm run build`
Expected: PASS.

Browser: on Run & Reports, change a load and re-run. The changed numbers count and glow, and the final values are identical to `main`'s for the same design.

- [ ] **Step 7: Commit**

```bash
git add src/lib/countUp.js src/lib/__tests__/countUp.test.js src/components/Readout.jsx src/pages/ReportsPage.jsx src/pages/DailyPage.jsx src/pages/BessHostingPage.jsx src/styles.css
git commit -m "UI stage 1: Readout counts results to new values"
```

---

### Task 7: Depth motion: tilt, page entrance, skeleton loading, drawer motion

**Files:**
- Create: `client/src/lib/tilt.js`, `client/src/lib/__tests__/tilt.test.js`
- Create: `client/src/hooks/useTiltDelegate.js`
- Modify: `client/src/components/AppShell.jsx` (page key, tilt delegate, skeleton fallback)
- Modify: `client/src/App.jsx` (Suspense fallback), `client/src/components/IssuesPanel.jsx` (exit animation)
- Modify: `client/src/styles.css` (motion section)

**Interfaces:**
- Produces `tiltFor(px: number, py: number, rect: {left, top, width, height}, maxDeg = 3): { rx: number, ry: number }`:
  - `nx = (px - left - width/2) / (width/2)` and `ny` likewise, both clamped to [-1, 1].
  - `rx = -ny * maxDeg`, `ry = nx * maxDeg`.
  - A zero-size rect returns `{ rx: 0, ry: 0 }`.
- Produces `useTiltDelegate(containerRef, selector = '.stat'): void`:
  - Uses `pointermove`, throttled with `requestAnimationFrame`, on the closest matching element. It sets `--rx` and `--ry` (in deg) and resets them on `pointerleave` and `pointerout`.
  - Does nothing when `matchMedia('(hover: none)')` or reduced motion matches.

- [ ] **Step 1: Write the failing tilt tests**

```js
const r = { left: 0, top: 0, width: 200, height: 100 };
expect(tiltFor(100, 50, r)).toEqual({ rx: 0, ry: 0 });
expect(tiltFor(0, 0, r)).toEqual({ rx: 3, ry: -3 });
expect(tiltFor(200, 100, r)).toEqual({ rx: -3, ry: 3 });
expect(tiltFor(-500, 50, r).ry).toBe(-3);                       // clamped outside the rect
expect(tiltFor(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ rx: 0, ry: 0 });
```

Use `toBeCloseTo` for values affected by `-0`, or normalise `-0` to `0` in the implementation.

- [ ] **Step 2: Run them and confirm they fail; implement `tilt.js`; confirm they pass**

Run: `npx vitest run src/lib/__tests__/tilt.test.js`
Expected: first FAIL, then PASS.

- [ ] **Step 3: Wire up the motion**

**Tilt:**
- `useTiltDelegate(mainRef)` runs in `AppShell`.
- CSS: `.stat{transform: perspective(700px) rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg)) translateY(var(--lift,0px)); transition: transform var(--dur-1) var(--ease-out), box-shadow var(--dur-1)}` and `.stat:hover{--lift:-2px}`.
- The same lift (without tilt) for `.card:hover` when it contains buttons or links: `.card:has(a, button):hover`.

**Page entrance:** `AppShell` wraps the routes in `<div className="page" key={location.pathname}>` with `@keyframes page-in{from{opacity:0;transform:translateY(6px)}}` over `--dur-3` `--ease-out`. There is no exit animation.

**Skeleton loading:** the Suspense fallback becomes `<div className="skeleton-page" role="status" aria-label="Loading…"><div className="sk sk-title"/><div className="sk sk-card"/><div className="sk sk-card"/></div>`. Each `.sk` has a `--panel-2` base and a moving highlight, `@keyframes sk-sweep`, 1.4 s.

**Issues drawer:**
- Keep it mounted for 200 ms after close, with class `closing`. Exit uses `--ease-in`, translateX(16px) and opacity 0.
- Entry: `@keyframes drawer-in{from{opacity:0;transform:translateX(24px)}}` over `--dur-3`.
- `.explain-drawer` gets the same entry animation. **No exit animation:** its callers unmount it directly, and changing every caller is out of scope.
- The phone sidebar uses `transform: translateX(-100%)` → `0`, with `--dur-3` in and `--dur-2` out.

**Reduced motion:** the global rule from Task 1 makes all of this instant. The tilt hook does nothing.

- [ ] **Step 4: Run the checks, then check in the browser**

Run: `npm test && npm run lint && npm run build`
Expected: PASS.

Browser:
- Tiles tilt and lift with a mouse.
- No tilt under DevTools touch emulation, and none with reduced motion emulated.
- Pages fade and rise on navigation.
- On a slow network (Fast 3G) the skeleton shows.
- The Issues drawer slides in and out.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tilt.js src/lib/__tests__/tilt.test.js src/hooks/useTiltDelegate.js src/components/AppShell.jsx src/components/IssuesPanel.jsx src/App.jsx src/styles.css
git commit -m "UI stage 1: tilt, page entrance, skeleton loading, drawer motion"
```

---

### Task 8: Print styles

**Files:**
- Modify: `client/src/styles.css` (new `@media print` section at the end)

- [ ] **Step 1: Add `@media print`**

- **Light colours whatever the theme:** set `:root, :root[data-theme='dark']` to the light token values. Repeat the light hex values from the first `:root` block.
- **Plain background:** `body{background:#fff}`.
- **Strip effects:** on `*`, `box-shadow:none!important; backdrop-filter:none!important; animation:none!important; transition:none!important`.
- **Hide the chrome:** `.sidebar, header.top, .sidebar-backdrop, .issues-fab, .issues-drawer, .palette-backdrop, .skip-link` get `display:none`.
- **Layout:** `.shell{display:block}`.
- **Cards:** `.card{break-inside:avoid; border:1px solid #D5DEEA; background:#fff}`.

- [ ] **Step 2: Browser check**

DevTools emulates print media on Run & Reports in **dark** theme: white page, dark text, no sidebar or top bar, no cards split badly. Also do a real print preview (Ctrl+P) of the report.

- [ ] **Step 3: Commit**

```bash
git add src/styles.css
git commit -m "UI stage 1: print styles"
```

---

### Task 9: Polish pass on the main pages

**Files:**
- Modify:
  - Build pages: `client/src/pages/SetupPage.jsx`, `NetworkPage.jsx`, `DiagramPage.jsx`
  - Overview pages: `ReportsPage.jsx`, `DashboardPage.jsx`
  - Advisor pages: `HostingPage.jsx`, `BessHostingPage.jsx`, `FeederSplitPage.jsx`, `LoadBalancePage.jsx`, `ReconductorPage.jsx`, `FixItPage.jsx`
  - Fixes elsewhere: `DailyPage.jsx:218`, `MapPage.jsx`
- Modify: `client/src/styles.css` (utility classes)

**Interfaces:**
- Produces these utilities in `styles.css`: `.stack` (vertical gap `--s-4` between direct children), `.mt-2`, `.mt-3`, `.mt-4` (8, 12 and 16 px top margin), and `.hint.error` (Task 4).

- [ ] **Step 1: Replace only these inline-style patterns on the listed pages**

1. `fontSize`, `fontWeight`, `fontFamily` or `margin` on `h1`, `h2`, `h3` move to the stylesheet (remove the inline style).
2. `style={{ marginTop: N }}` between sibling cards or grids becomes `.mt-2`, `.mt-3` or `.mt-4`, whichever is nearest. Parents with three or more such children become `.stack`.
3. `style={{ color: 'var(--bad)' }}` on `.hint` becomes `className="hint error"`.
4. A literal colour or a `var(--x, #hex)` fallback becomes the plain token. `DailyPage.jsx:218` becomes `var(--line)`.
5. Ad-hoc `border`, `borderRadius` or `background` that duplicate `.card`, `.note` or `.stat` use that class instead.

Leave every other inline style alone. Don't change text, order or logic.

- [ ] **Step 2: Run the checks**

Run: `npm test && npm run lint && npm run build`
Expected: PASS. `git diff --stat` touches only the files listed above.

- [ ] **Step 3: Browser check**

Each listed page in both themes at 1440 px and 390 px. Spacing is consistent, nothing overlaps, and there is no horizontal scroll at 390 px.

- [ ] **Step 4: Commit**

```bash
git add src/pages src/styles.css
git commit -m "UI stage 1: polish pass on the main pages"
```

---

### Task 10: Verification and fixes

**Setup:**
- Start the API: from the repo root, `docker compose up -d db server`, or the existing stack, with the API on `:4000`.
- Then, in `client/`, run `npm run dev`. The app is at `http://localhost:5173`.
- Register a throwaway account at `/register`, and load the test design from `docs/test-data/` if needed.
- Drive the browser with the Chrome DevTools MCP tools.

- [ ] **Step 1: axe on every page**

- For each of the 22 pages plus Login, in both themes: inject axe-core 4.10 (`https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js`) via `evaluate_script`.
- Run `axe.run(document, {runOnly: ['wcag2a','wcag2aa','wcag21a','wcag21aa']})`.
- Expected: `violations.length === 0` for all 46 runs. Fix anything found and re-run.

- [ ] **Step 2: Phone width (390 px)**

- For each page: `document.documentElement.scrollWidth <= window.innerWidth`.
- Expected: true everywhere.

- [ ] **Step 3: Keyboard and Review Focus checks**

- Sidebar, drawer, palette and drawers using only the keyboard.
- Review Focus 2: Escape layering.
- Review Focus 4: resize while the drawer is open.
- Review Focus 5: `/app/wizard` header.
- Sinhala palette search.

Expected: as described in each task's browser check.

- [ ] **Step 4: Lighthouse performance on Dashboard and Run & Reports**

- Compare this branch with `main`, using `git stash`/`switch` or two builds with `npm run preview`.
- Expected: Performance score within 5 points of `main`, and total JS within +10 KB gzip.

- [ ] **Step 5: Screenshots for the user**

- Setup, Network, Diagram, Reports, Dashboard, Charts, Map and Login.
- Both themes, at 1440 px and 390 px.

- [ ] **Step 6: Full checks and commit**

Run: `npm test && npm run lint && npm run typecheck && npm run build`
Expected: all PASS.

```bash
git add -A client/src
git commit -m "UI stage 1: verification fixes"
```

(Skip the commit if there were no fixes.)
