# OpenDSS comparison app: a side-by-side demo of a saved LV island

Date: 2026-11-09. Branch: `ui-redesign-stage1`. Status: approved in conversation, section by section.

## 1. Goal and scope

A separate web app, for presentations, that opens an LV island already designed and saved in
Feeder Island, solves one hour of it in both Feeder Island and OpenDSS, and shows the two results
side by side so an audience can see they agree.

In scope:

- A second entry point in the client build, `client/compare.html`, with its own React root in
  `client/src/compare/`. Own URL, own title, full-screen layout, no sidebar.
- One snapshot per comparison, at an hour chosen live.
- Five views: verdict, headline numbers, two single-line diagrams, a parity chart, a bus-by-bus table.
- An "Open in comparison app" link per saved design on the Designs page.
- Small additions to the OpenDSS check route, the engine's check case and the validator.

Out of scope:

- A 24 h comparison, a year picker, load and solar multipliers (year is fixed at 0, multipliers at 1).
- Independent proof (an OpenDSS model built without the app's exporter). This is a demo of agreement,
  not a third-party verification.
- Offline use of the comparison app, and a sign-in form of its own.
- A separate package, container or port.

Users: a presenter (engineer) showing a saved island to an audience, on a desktop or a projector.
English only (the demo screen is not added to the i18n files). Light and dark themes both work.

## 2. Decisions taken

| Question | Decision |
|---|---|
| Purpose | A side-by-side demo for a presentation. |
| How the app reaches the saved island | A second web app in this repo, same site, same sign-in, picks from your saved designs. |
| What it shows | Headline numbers, bus-by-bus table, parity chart, two diagrams; one hour chosen live. |
| Build approach | A second Vite entry point (`compare.html`) in the existing client build, not a separate package. |
| Hand-off from the main app | "Open in comparison app" link on the Designs page, `/compare.html?design=<id>`. |

## 3. Constraints found in the code

- `POST /api/opendss/check` (`server/src/routes/opendss.js`) already exports a design with the
  engine's `openDSSCheckCase`, solves it in OpenDSS through `scripts/validate-opendss.py --single`
  and compares every bus voltage and span current. Its `summarise()` drops the full `points` and
  `currents` lists and keeps the 5 worst voltages; the Reports page relies on that summary.
- The validator's `points` are `[id, phase, appV, dssV]` for every transformer bus and pole, phases
  A, B, C. Its `currents` are `[id, phase, appA, dssA]` for every span, phases A, B, C and N.
- `buildSldScene(design, res, opts)` (`client/src/lib/sld/scene.js`) reads voltages from
  `res.poleResults[].volt[phase]` and `res.transformers[].busVoltPct[phase]` (volts, historical name),
  loading from `condPct` and `txPct`, flow from `flowKW`. `SingleLineDiagram.jsx` renders the scene.
- The app's transformer apparent power is `txKVA` in the solver's transformer summary: the magnitude
  of the sum over phases of V(bus, phase to neutral) times conj(I into the feeders).
- The OpenDSS transformer is exported as `buses=[<hv>.1.2.3 <lv>.1.2.3.4]`, so terminal 2 (LV) has
  4 conductors.
- nginx serves an existing file before falling back to `index.html` (`try_files $uri /index.html`),
  so `/compare.html` needs no nginx change. The service worker only falls back to `index.html` when
  offline.
- The API's JSON body limit is 600 kB; the check already sends the whole design (without the logo).
- `api.getDesign(id)` returns `{ design, meta }`; every design entering the app goes through
  `withDefaults`.

## 4. Screen

Top to bottom, in one full-width column:

1. **Controls bar.** Saved-design drop-down (pre-selected from `?design=<id>`), hour picker 0 to 23,
   two shortcuts "Evening peak 20:00" and "Solar noon 12:00", and a **Compare** button.
2. **Verdict.** Pass or Fail against the check's tolerance (500 mV today), the OpenDSS version, the
   number of OpenDSS iterations and how long the comparison took.
3. **Headline numbers.** Five cards, each showing Feeder Island, OpenDSS and the difference:
   - Total losses (kW): `losses.appW` and `losses.dssW`.
   - Lowest voltage (V): the smallest app value and the smallest OpenDSS value over `points`.
   - Highest voltage (V): the largest of each over `points`.
   - Transformer loading (kVA): one line per transformer from `transformers`.
   - Largest neutral current (A): the largest of each over `currents` with phase N.
4. **Two single-line diagrams side by side**, titled "Feeder Island" and "OpenDSS", stacked on a
   narrow screen. Both use only the voltage overlay (`overlays: { voltage: true, loading: false,
   flow: false }`), so the two drawings are the same apart from the numbers.
5. **Parity chart.** Every bus and phase, Feeder Island voltage (y) against OpenDSS voltage (x), with
   the line of perfect agreement. Built like the Validation page's chart (`ChartCanvas`, themed scales).
6. **Bus-by-bus table.** Every transformer bus and pole, phases A, B, C: Feeder Island V, OpenDSS V,
   difference in mV, sorted by the size of the difference, largest first. Scrolls in its own frame.

## 5. Data flow

1. On load: `api.me()`; on 401 show the sign-in message. Then `api.listDesigns()`.
2. **Compare** loads the chosen design (`api.getDesign(id)`, then `withDefaults(d.design)`) and, in
   parallel:
   - runs `runSnapshotAt(design, { year: 0, hour, loadMult: 1, solarMult: 1 })` in the browser, used
     only as the structure of the diagrams' result object;
   - posts `{ design: { ...design, logo: undefined }, opts, full: true }` to `/api/opendss/check`.
3. Every number on the screen comes from the check's answer. Each diagram gets a copy of the
   browser's result with that tool's voltages from `points` swapped into `poleResults[].volt` and
   `transformers[].busVoltPct` (column 2 for Feeder Island, column 3 for OpenDSS). The swap and the
   card values are pure functions in `client/src/compare/compareData.js`.
4. A counter, as on the Reports page, makes sure only the latest Compare click's answer is shown.

### Server and validator changes

- `server/src/routes/opendss.js`: when the request body has `full: true`, the response keeps
  `points` and `currents`. Without it the response is unchanged. `transformers` is kept in both.
- `packages/engine/opendss.js`, `openDSSCheckCase`: each entry of `app.transformers` gains
  `kVA: t.txKVA`.
- `scripts/validate-opendss.py`, `run_case`: adds `"transformers": [[id, appKVA, dssKVA], ...]`.
  The OpenDSS value is the magnitude of the summed real and reactive power over the 4 conductors of
  the transformer's LV terminal, matched to the app's transformer by its LV bus name. It also counts
  the small power into the transformer's earth electrode, which the app's `txKVA` leaves out; that is
  watts on tens of kVA.

At the server's cap (3000 poles) the full answer is about 1 MB of JSON.

## 6. Error handling

| Situation | Screen |
|---|---|
| Not signed in (401) | "Sign in to Feeder Island first", with a link to the main app. |
| No saved designs | "Save an island in Feeder Island first." |
| OpenDSS missing on the server (503) | The server's message (it names `opendssdirect.py`); no results. |
| OpenDSS too slow (504) or failed (502) | The server's message and a **Try again** button. |
| Design too large or invalid (400) | The server's message. |
| Feeder Island's solve did not converge | `SolveStatusWarning` above the results; the comparison still shows. |
| Compare clicked again before the answer | Only the latest answer is shown. |

## 7. Files

New:

- `client/compare.html`: the second HTML entry, same fonts, favicon and theme colour as `index.html`.
- `client/src/compare/main.jsx`: React root with `ThemeProvider` and the shared stylesheet.
- `client/src/compare/CompareApp.jsx`: the screen.
- `client/src/compare/compareData.js`: voltage swap, card values, table rows (pure).
- `client/src/lib/__tests__/compareData.test.js`: tests for `compareData.js`.

Changed:

- `client/vite.config.js`: `build.rollupOptions.input` lists `index.html` and `compare.html`.
- `client/src/api.js`: `opendssCheck(design, opts, full)` passes `full`.
- `client/src/pages/DesignsPage.jsx`: "Open in comparison app" link per design.
- `server/src/routes/opendss.js`, `packages/engine/opendss.js`, `scripts/validate-opendss.py`: as in §5.
- `server/test/opendss.test.js`: tests in §8.

## 8. Testing

- `compareData.test.js` (vitest): the voltage swap puts each tool's values in the right pole, phase
  and transformer; card values for a single- and a two-transformer design; table rows sorted by the
  size of the difference.
- `server/test/opendss.test.js`: with `full: true` the fake validator's `points` and `currents` come
  back; without it they are dropped as today; the real OpenDSS test (runs where `opendssdirect.py` is
  installed; it is, 0.9.4, on the development machine) also checks the transformer kVA agree within
  0.01 kVA.
- Existing suites: client vitest, server tests, `npm run lint`, `npm run build`. The build must emit
  `compare.html` next to `index.html`.
- Manual: dev servers running, open `/compare.html` from the Designs page link, compare at 20:00 and
  12:00, in light and dark themes, and at a narrow width.
