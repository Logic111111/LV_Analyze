# OpenDSS Comparison App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A separate web page, `/compare.html`, that solves one hour of a saved LV island in Feeder Island and OpenDSS and shows the two side by side for a presentation.

**Architecture:** A second Vite entry point in the existing client build, with its own React root. It calls the existing `POST /api/opendss/check` with a new `full: true` flag that keeps every bus voltage and span current; the validator also reports transformer kVA. Every number on screen comes from that one answer; pure helpers in `client/src/compare/compareData.js` turn it into diagram inputs, cards and table rows.

**Tech Stack:** React 18, Vite 5, Chart.js 4 (via `ChartCanvas`), vitest (client), `node --test` + supertest (server), Python 3 with opendssdirect.py 0.9.4 (validator).

**Spec:** `docs/superpowers/specs/2026-11-09-opendss-compare-app-design.md`

## Global Constraints

- No new dependencies (npm or pip).
- Year fixed at 0, load and solar multipliers fixed at 1. Hour 0 to 23, shortcuts "Evening peak 20:00" and "Solar noon 12:00".
- The demo screen is English only: no `t('…')` calls in `client/src/compare/` (the i18n test requires every literal `t('…')` key to be in `en.json`).
- Without `full: true` the `/check` response must stay exactly as today (the Reports page depends on it), apart from the added `transformers` list.
- Both diagrams use `overlays: { voltage: true, loading: false, flow: false }`.
- Every number on the compare screen comes from the check's answer; the browser's own `runSnapshotAt` result is used only as the diagrams' structure.
- Do not commit. `packages/engine/opendss.js`, `scripts/validate-opendss.py`, `client/src/api.js` and `client/src/lib/__tests__/opendss.test.js` already have uncommitted edits, and `server/src/routes/opendss.js` and `server/test/opendss.test.js` are untracked (the OpenDSS check itself is not committed yet). Committing per task would sweep that work in; the user commits it all together.

## Review Focus

1. Hour changed after a comparison without pressing Compare: the verdict must still name the hour of the answer on screen (`check.hour`), not the picker's. Pinned in Task 4, Step 6.
2. A transformer with no poles (or a check with no neutral currents): the neutral-current card shows "—", nothing throws. Pinned in Task 3 (`headline` test).
3. Session expires mid-demo (the check answers 401): the server's message and **Try again** show, the page does not go blank. Pinned in Task 4, Step 6.
4. `?design=<id>` for a design not in your list (deleted, or not yours): the first saved design is selected instead, no error. Pinned in Task 4, Step 6.
5. A large island (hundreds of poles): the table scrolls inside its frame and neither the table nor the diagrams widen the page. Pinned in Task 4, Step 6.

---

### Task 1: Transformer kVA in the check case and the validator

**Files:**
- Modify: `packages/engine/opendss.js` (`openDSSCheckCase`, the `transformers:` line of `app`)
- Modify: `scripts/validate-opendss.py` (`run_case`)
- Test: `client/src/lib/__tests__/opendss.test.js`, `server/test/opendss.test.js`

**Interfaces:**
- Produces: `openDSSCheckCase(...).app.transformers[i].kVA: number` (the app's `txKVA`).
- Produces: the validator's `--single` JSON gains `transformers: Array<[id: string, appKVA: number, dssKVA: number]>`, one per transformer in `app["transformers"]` order, values rounded to 6 decimals like `points`.

- [ ] **Step 1: Write the failing tests**

In `client/src/lib/__tests__/opendss.test.js`, inside the existing `openDSSCheckCase` test, add:

```js
expect(app.transformers[0].kVA).toBe(res.transformers[0].txKVA);
```

In `server/test/opendss.test.js`, in `real OpenDSS agrees with the app on the default design`, add:

```js
assert.equal(r.body.transformers.length, 1);
const [, appKVA, dssKVA] = r.body.transformers[0];
assert.ok(appKVA > 0, `app kVA ${appKVA}`);
assert.ok(Math.abs(appKVA - dssKVA) < 0.01, `app ${appKVA} kVA, OpenDSS ${dssKVA} kVA`);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd client && npx vitest run src/lib/__tests__/opendss.test.js` (expected: FAIL, `kVA` is `undefined`)
Run: `cd server && node --test test/opendss.test.js` (expected: the real-OpenDSS test FAILs on `r.body.transformers` being undefined; it runs because opendssdirect.py 0.9.4 is installed)

- [ ] **Step 3: Add `kVA: t.txKVA` to each `app.transformers` entry in `openDSSCheckCase`**

- [ ] **Step 4: Add `transformer_kva()` to `scripts/validate-opendss.py` and use it in `run_case`**

`transformer_kva() -> dict[str, float]`: LV bus name (lower case, without node suffix) to the OpenDSS apparent power in kVA at the transformer's LV terminal. Algorithm:

```python
for name in dss.Transformers.AllNames():
    dss.Transformers.Name(name)
    n = dss.CktElement.NumConductors()
    t2 = dss.CktElement.Powers()[2 * n:4 * n]   # terminal 2 (LV): (kW, kvar) per conductor
    bus = dss.CktElement.BusNames()[1].split(".")[0].lower()
    out[bus] = math.hypot(sum(t2[0::2]), sum(t2[1::2]))
```

In `run_case`, add to the returned dict:
`"transformers": [[t["id"], round(t["kVA"], 6), round(kva[t["bus"].lower()], 6)] for t in app["transformers"]]`.

- [ ] **Step 5: Run the tests to verify they pass**

Run the two commands from Step 2. Expected: PASS (the real test included, not skipped).
Run: `python scripts/validate-opendss.py` (expected: ends with `PASS (tolerance 0.5 V)`; the batch run still works with the new field).

---

### Task 2: `full: true` on the OpenDSS check route

**Files:**
- Modify: `server/src/routes/opendss.js` (`summarise`, the `/check` handler)
- Test: `server/test/opendss.test.js`

**Interfaces:**
- Consumes: the validator result from Task 1 (`transformers`).
- Produces: `POST /api/opendss/check` body `{ design, opts, full?: boolean }`. With `full === true` the response is the validator's result plus `worst`, keeping `points: Array<[id, phase, appV, dssV]>`, `currents: Array<[id, phase, appA, dssA]>` and `transformers`. Otherwise as today (no `points`, no `currents`), with `transformers` kept.
- Produces: `summarise(r: object, full = false): object` (exported as today).

- [ ] **Step 1: Write the failing test**

Add to `server/test/opendss.test.js`:

```js
test('with full: true returns every point and current, and the transformer kVA either way', async () => {
  const result = { ok: true, pass: true, voltage: { max: 0.0001, n: 2 }, points: [['P1', 'A', 230, 230.0001], ['P2', 'B', 228, 228]], currents: [['P1', 'N', 1, 1]], transformers: [['TX', 50, 50.001]] };
  const agent = await signedIn(async () => result);
  const d = (await loadEngine()).defaultDesign();
  const full = await agent.post('/api/opendss/check').send({ design: d, opts: snap, full: true });
  assert.equal(full.status, 200);
  assert.deepEqual(full.body.points, result.points);
  assert.deepEqual(full.body.currents, result.currents);
  assert.deepEqual(full.body.transformers, result.transformers);
  assert.deepEqual(full.body.worst.map(w => w.id), ['P1', 'P2']);
  const brief = await agent.post('/api/opendss/check').send({ design: d, opts: snap, full: 'yes' });
  assert.equal(brief.body.points, undefined);
  assert.equal(brief.body.currents, undefined);
  assert.deepEqual(brief.body.transformers, result.transformers);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd server && node --test test/opendss.test.js`
Expected: the new test FAILs (`full.body.points` is undefined); the existing summary test still passes.

- [ ] **Step 3: Implement `summarise(r, full = false)`**

Delete `points` and `currents` only when `!full`; the handler passes `req.body.full === true` (strictly `true`, so `'yes'` gives the brief answer).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && npm test`
Expected: all pass, including `routes.test.js` and the real OpenDSS test.

---

### Task 3: Pure comparison helpers

**Files:**
- Create: `client/src/compare/compareData.js`
- Test: `client/src/lib/__tests__/compareData.test.js`

**Interfaces:**
- Consumes: the check answer from Task 2 (`points`, `currents`, `transformers`, `losses.appW`, `losses.dssW`).
- Produces:
  - `withVoltages(res, points, col)`: a copy of a `runSnapshotAt` result `res` with, for every `[id, phase, appV, dssV]` in `points`, `poleResults[k].volt[phase]` (pole ids) or `transformers[k].busVoltPct[phase]` (transformer ids) set to element `col` (`2` = Feeder Island, `3` = OpenDSS). Never mutates `res`. Ids not in `points` keep their values.
  - `headline(check)`: `{ lossKW: Pair, minV: Pair, maxV: Pair, neutralA: Pair, transformers: Array<{ id: string, app: number, dss: number }> }` with `Pair = { app: number | null, dss: number | null }`. `lossKW` from `losses.appW / 1000` and `losses.dssW / 1000`; `minV`/`maxV` over `points`; `neutralA` the largest over `currents` with phase `'N'`; `null` when the list has nothing to take it from.
  - `tableRows(points)`: `Array<{ id, phase, app, dss, diffMV }>` with `diffMV = (app - dss) * 1000`, sorted by `Math.abs(diffMV)` largest first (ties keep input order).

- [ ] **Step 1: Write the failing tests**

`client/src/lib/__tests__/compareData.test.js`, with hand-built inputs (no engine run):

```js
import { describe, it, expect } from 'vitest';
import { withVoltages, headline, tableRows } from '../../compare/compareData.js';

const res = {
  poleResults: [{ id: 'P1', volt: { A: 1, B: 1, C: 1 }, condPct: { A: 5, B: 5, C: 5 } }, { id: 'P2', volt: { A: 1, B: 1, C: 1 } }],
  transformers: [{ id: 'T1', busVoltPct: { A: 1, B: 1, C: 1 }, txPct: 40 }, { id: 'T2', busVoltPct: { A: 1, B: 1, C: 1 } }]
};
const points = [['T1', 'A', 240, 240.001], ['P1', 'A', 230, 229.9], ['P1', 'B', 231, 231.0005], ['T2', 'C', 239, 238.99]];
const check = { losses: { appW: 1500, dssW: 1499 }, points, currents: [['P1', 'A', 9, 9.1], ['P1', 'N', 4, 4.2], ['P2', 'N', 6, 5.9]], transformers: [['T1', 60, 60.002], ['T2', 30, 29.999]] };

describe('withVoltages', () => {
  it('puts the chosen tool\'s voltage on each pole and transformer bus, leaving the rest and the input alone', () => {
    const before = JSON.stringify(res);
    const dss = withVoltages(res, points, 3);
    expect(dss.poleResults[0].volt).toEqual({ A: 229.9, B: 231.0005, C: 1 });
    expect(dss.poleResults[1].volt).toEqual({ A: 1, B: 1, C: 1 });
    expect(dss.transformers[0].busVoltPct.A).toBe(240.001);
    expect(dss.transformers[1].busVoltPct.C).toBe(238.99);
    expect(dss.poleResults[0].condPct).toEqual({ A: 5, B: 5, C: 5 });
    expect(withVoltages(res, points, 2).poleResults[0].volt.A).toBe(230);
    expect(JSON.stringify(res)).toBe(before);
  });
});

describe('headline', () => {
  it('pairs each card\'s value from both tools, one transformer line each', () => {
    const h = headline(check);
    expect(h.lossKW).toEqual({ app: 1.5, dss: 1.499 });
    expect(h.minV).toEqual({ app: 230, dss: 229.9 });
    expect(h.maxV).toEqual({ app: 240, dss: 240.001 });
    expect(h.neutralA).toEqual({ app: 6, dss: 5.9 });
    expect(h.transformers).toEqual([{ id: 'T1', app: 60, dss: 60.002 }, { id: 'T2', app: 30, dss: 29.999 }]);
  });
  it('gives null, not Infinity, when there is nothing to take a value from', () => {
    const h = headline({ ...check, points: [], currents: [['P1', 'A', 9, 9]] });
    expect(h.minV).toEqual({ app: null, dss: null });
    expect(h.maxV).toEqual({ app: null, dss: null });
    expect(h.neutralA).toEqual({ app: null, dss: null });
  });
});

describe('tableRows', () => {
  it('lists every point with its difference in mV, largest first', () => {
    const rows = tableRows(points);
    expect(rows.map(r => r.id + r.phase)).toEqual(['P1A', 'T2C', 'T1A', 'P1B']);
    expect(rows[0].diffMV).toBeCloseTo(100, 6);
    expect(rows[3]).toMatchObject({ id: 'P1', phase: 'B', app: 231, dss: 231.0005 });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd client && npx vitest run src/lib/__tests__/compareData.test.js`
Expected: FAIL, cannot resolve `../../compare/compareData.js`.

- [ ] **Step 3: Implement `withVoltages`, `headline` and `tableRows` in `client/src/compare/compareData.js`**

Plain functions, no imports. Transformer ids are told apart from pole ids by membership in `res.transformers`.

- [ ] **Step 4: Run them to verify they pass**

Run: `cd client && npx vitest run src/lib/__tests__/compareData.test.js`
Expected: PASS.

---

### Task 4: The comparison app and the Designs-page link

**Files:**
- Create: `client/compare.html`
- Create: `client/src/compare/main.jsx`
- Create: `client/src/compare/CompareApp.jsx`
- Modify: `client/vite.config.js` (add `build.rollupOptions.input`)
- Modify: `client/src/api.js` (`opendssCheck`)
- Modify: `client/src/pages/DesignsPage.jsx` (saved-designs table, the actions cell)

**Interfaces:**
- Consumes: `withVoltages`, `headline`, `tableRows` (Task 3); `POST /api/opendss/check` with `full: true` (Task 2); `buildSldScene(design, res, { overlays })` from `client/src/lib/sld/scene.js`; `SingleLineDiagram` (`scene`, `theme`, `maxHeight`, `label`); `ChartCanvas`, `CHART_PALETTES`, `themedScales` as used in `client/src/pages/ValidationPage.jsx`; `SolveStatusWarning` from `client/src/components/Convergence.jsx`; `runSnapshotAt`, `withDefaults` from `client/src/lib/loadflow.js`; `api.me`, `api.listDesigns`, `api.getDesign` (returns `{ design, meta }`).
- Produces: `api.opendssCheck(design, opts, full = false)` sending `{ design, opts, full }`; the page at `/compare.html?design=<id>`.

- [ ] **Step 1: Entry point and build**

`client/compare.html`: a copy of `index.html`'s head (charset, viewport, fonts, favicon, theme colour) with `<title>Feeder Island vs OpenDSS</title>`, no manifest link, and `<script type="module" src="/src/compare/main.jsx">`.
`client/src/compare/main.jsx`: renders `<React.StrictMode><ThemeProvider><CompareApp /></ThemeProvider></React.StrictMode>` into `#root` and imports `../styles.css`. No router, no service-worker registration.
`client/vite.config.js`: `build.rollupOptions.input = { main: fileURLToPath(new URL('./index.html', import.meta.url)), compare: fileURLToPath(new URL('./compare.html', import.meta.url)) }`.

- [ ] **Step 2: `api.opendssCheck(design, opts, full = false)`**

Body `JSON.stringify({ design, opts, full })`. The Reports page's existing call keeps working unchanged.

- [ ] **Step 3: `CompareApp.jsx`**

State and behaviour (the layout and copy are the spec's §4 and §6):
- On mount: `api.me()`; an error with `status === 401` shows "Sign in to Feeder Island first" with a link to `/login`. Then `api.listDesigns()`; empty shows "Save an island in Feeder Island first." Initial selection: the `design` URL parameter if it is in the list, otherwise the first design.
- **Compare**: increments a ref counter (as `ReportsPage.jsx` `checkId`); loads `withDefaults((await api.getDesign(id)).design)`; runs `runSnapshotAt(design, opts)` with `opts = { year: 0, hour, loadMult: 1, solarMult: 1 }`; awaits `api.opendssCheck({ ...design, logo: undefined }, opts, true)`, timing it with `performance.now()`; drops the answer if the counter moved. Keeps `{ design, res, check, ms }` for rendering.
- Any error during Compare: show `e.message` (the server's text) and a **Try again** button that runs Compare again.
- Verdict: Pass/Fail pill from `check.pass`, `check.tolerance * 1000` mV, `check.opendss` (with ` revision…` stripped, as on the Validation page), `check.iterations`, `ms`, and the answer's hour from `check.hour` formatted `HH:00`.
- `SolveStatusWarning res={res}` above the results.
- Cards from `headline(check)`: each shows Feeder Island, OpenDSS and the difference; `null` shows "—". Cards in a `.grid` with `gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))'`.
- Diagrams: `.grid g2`, each card `minWidth: 0`, titled "Feeder Island" and "OpenDSS"; `scene = buildSldScene(design, withVoltages(res, check.points, col), { overlays: { voltage: true, loading: false, flow: false } })` with `col` 2 and 3, `maxHeight="60vh"`. Memoise both scenes on the answer.
- Parity chart: like `ValidationPage.jsx` `parity`, points `{ x: dss, y: app }` from `check.points`, axis titles "OpenDSS voltage (V, phase to neutral)" and "Feeder Island voltage (V)".
- Table from `tableRows(check.points)` in a `.tbl-wrap` with `maxHeight: '60vh'`: columns Bus, Phase, Feeder Island (V), OpenDSS (V), Difference (mV); volts to 3 decimals, mV to 2.
- A hint under the controls: "Compares the last saved version of the island."

- [ ] **Step 4: Designs-page link**

In `DesignsPage.jsx`'s saved-designs actions cell, add `<a className="mini btn-link" href={`/compare.html?design=${encodeURIComponent(d.id)}`} target="_blank" rel="noopener">Open in comparison app</a>`.

- [ ] **Step 5: Automated checks**

Run: `cd client && npm test` (expected: all pass, including `i18n.test.js` and `compareData.test.js`)
Run: `cd client && npm run lint` (expected: no errors)
Run: `cd client && npm run build` (expected: success, and `ls dist` shows both `index.html` and `compare.html`)

- [ ] **Step 6: Manual check (dev servers: `cd server && npm run dev`, `cd client && npm run dev`)**

Signed in, from Designs, open a saved island in the comparison app, then check each:
- Compare at 20:00 and at 12:00: Pass, both diagrams show the same voltages to the displayed precision, the table's top row matches the largest difference.
- After a comparison, change the hour without pressing Compare: the verdict still names the compared hour (Review Focus 1).
- Open `/compare.html?design=does-not-exist`: the first saved design is selected, no error (Review Focus 4).
- Log out in another tab, press Compare: the server's message and **Try again** show (Review Focus 3).
- Press Compare twice quickly: one result, from the second press.
- An island with many poles at 390 px width: the table and diagrams scroll inside their frames, no horizontal page scroll (Review Focus 5).
- Toggle the theme in the main app and reload: the comparison app follows it, diagrams and chart readable in both.
