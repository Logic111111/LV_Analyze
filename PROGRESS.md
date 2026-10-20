# Feeder Island — Upgrade Programme progress

This file is the hand-off log for the upgrade programme. A later session should be able to pick
up from here: what's done, what was decided, what's assumed, and what data is still needed.

Status key: `[x]` done · `[~]` in progress / partly done · `[ ]` not started · `[!]` blocked (see notes)

Rules that apply to every item (from the brief): golden numbers never change (Phase 0 tests are
the gate), every new design field gets a default in `withDefaults`, new behaviour is off by
default, the engine stays pure (no React/DOM/npm imports), the public `loadflow.js` API stays
stable, no invented engineering/commercial data, commit after each item, no pushes/PRs unless asked.

---

## Phase 0 — Safety net

- [x] **P0.1** Test harness — Vitest in `client/` (`npm test`), Walkthrough Island fixture
- [x] **P0.2** Golden tests — every row of the brief's golden table, import-surface test, old-format design test, plus a full-precision (1e-9) regression lock
- [x] **P0.3** CI — GitHub Actions: install, ESLint, tests, client build, `node --check` on the server

## Phase 1 — Correctness fixes, engine structure, performance

- [x] **P1.1** Split engine into `client/src/lib/engine/*` modules; `loadflow.js` becomes a re-export; JSDoc typedefs + `// @ts-check`
- [x] **P1.2** Library refactor — `getConductor(design, code)` / `getTransformerType(design, rating)` reading `design.conductorLibrary` / `design.transformerLibrary`
- [x] **P1.3** Bug fixes (each with a test that fails before the fix)
  - [x] 1. Hosting rounds up to an untested size (`Math.round` → `Math.floor(best*20+1e-9)/20`)
  - [x] 2. Pre-existing violations zero out hosting — baseline-relative feasibility + banner
  - [x] 3. Non-converged load flow counts as a pass in hosting/BESS — treat as infeasible; surface non-convergence on every scanning page
  - [x] 4. Feeder-split transformer current assumes balance — add `txMaxPhaseCurrentA` (true max phase current), show balanced-equivalent as secondary
  - [x] 5. AI model hard-coded — `ANTHROPIC_MODEL` env var (default `claude-sonnet-4-6`), documented in both `.env.example`
- [x] **P1.4** Performance — precompute per-pole `loadS`/`otherS` once per snapshot, `connectionsByPole` index, optional warm start (`initialV`), `npm run bench` (50 poles / 200 connections), before/after timings recorded here
- [x] **P1.5** Web Worker infrastructure — `engine.worker.js`, `runInWorker(task, args, {onProgress, signal})`, progress bar + Cancel on every long action

## Phase 2 — Engineering analyses

- [x] **P2.1** Symmetrical components & VUF (phasors kept in results; per pole/hour + worst over 24 h; `'unbalance'` violation only when `design.standards.vufAsViolation`)
- [x] **P2.2** Voltage-profile data — `distanceFromTx`, `voltageProfile`
- [ ] **P2.3** Fault level & protection check (`faults.js`, IEC 60909-style; fuse library empty by default; Protection panel + report section)
- [ ] **P2.4** Tap advisor (multi-year, ranking, unbalance diagnosis, off-load note, Apply/Preview)
- [ ] **P2.5** Editable conductor library + reconductoring advisor
- [ ] **P2.6** Fix-it ladder (combined solution advisor)
- [ ] **P2.7** Standards profiles (`design.standards`; "Current app defaults" profile reproduces today exactly)

## Phase 3 — Advanced modelling (all off by default)

- [ ] **P3.1** Smart-inverter PV (volt-var / volt-watt / export limit; IEEE 1547-2018 Cat B seed curves, labelled)
- [ ] **P3.2** BESS with state of charge (`schedule` default; `socSchedule` / `solarFollowing`)
- [ ] **P3.3** Transformer thermal ageing (IEC 60076-7)
- [ ] **P3.4** HV voltage profile (`hvProfile`, default all 1.0)
- [ ] **P3.5** Coupled line model (4×4 matrices, behind a flag)

## Phase 4 — Optimisation and mathematics

- [ ] **P4.1** Phase balancing v2 (impedance-weighted / load-flow objectives, local search, Pareto table, seeded SA)
- [ ] **P4.2** Voltage sensitivity matrix
- [ ] **P4.3** Solver robustness (diagnostics, α=0.3 retry, collapse detection)
- [ ] **P4.4** Probabilistic (Monte Carlo) planning
- [ ] **P4.5** Multi-criteria view for feeder split and fix-it ladder

## Phase 5 — UI/UX

- [ ] **P5.1** New single-line diagram (`SingleLineDiagram.jsx`, IEC 60617-style, overlays, before/after, SVG/PNG/PDF/DXF export)
- [ ] **P5.2** Interactive what-if (drag a drop to another phase; sensitivity preview, confirmed by full load flow)
- [ ] **P5.3** Engineering charts (V vs distance, phasor diagram, heatmap, loading-duration, VUF, fault level)
- [ ] **P5.4** Scenario manager and comparison
- [ ] **P5.5** Issues panel
- [ ] **P5.6** "Explain this number" drawer
- [ ] **P5.7** Map-based network editor (react-leaflet, configurable tiles, haversine "measured vs entered")
- [ ] **P5.8** Guided new-design wizard
- [ ] **P5.9** Report upgrade (new sections, print stylesheet, sign-off block, optional logo)
- [ ] **P5.10** Internationalisation & accessibility (`t()`, en default, Sinhala/Tamil machine drafts)

## Phase 6 — Data and economics

- [ ] **P6.1** Economics (loss cost, discount rate, cost table → LKR/yr, capex, payback, NPV)
- [ ] **P6.2** Demand from billing data (Velander, fitted from CSV)
- [ ] **P6.3** Smart-meter (AMI) import
- [ ] **P6.4** Measured vs simulated (incl. phase-label check)
- [ ] **P6.5** Fleet dashboard (`designs.summary` JSON column)
- [ ] **P6.6** Exports (xlsx, CSV, GeoJSON)

## Phase 7 — Platform

- [ ] **P7.1** Shared engine package (`packages/engine/`)
- [ ] **P7.2** Database migrations (numbered SQL, `schema_migrations`)
- [ ] **P7.3** Version history and undo/redo
- [ ] **P7.4** Teams, roles and approval workflow
- [ ] **P7.5** Session revocation
- [ ] **P7.6** OpenDSS export and cross-validation
- [ ] **P7.7** AI insights with tools
- [ ] **P7.8** Field mode (PWA)

---

## Waiting on data (from the user)

None of these will be invented. Until supplied, the relevant feature shows a "data missing" state.

- [ ] Fuse time-current data for the fuses used: Ia at 0.4 s and at 5 s, breaking capacity (P2.3)
- [ ] Additional conductor types: R (20 °C), X, neutral R/X, current rating, and unit costs (P2.5)
- [ ] Energy cost of losses (LKR/kWh) and discount rate (P6.1)
- [ ] Velander constants, or billing + measured-peak data to fit them (P6.2)
- [ ] Local grid-code inverter settings (volt-var / volt-watt curves, export limits) (P3.1)
- [ ] Ambient temperature profile for transformer ageing (P3.3)
- [ ] HV voltage profile (P3.4)
- [ ] Smart-meter (AMI) data (P6.3)
- [ ] Field voltage readings (P6.4)
- [ ] Native-speaker review of the Sinhala and Tamil text (P5.10)
- [ ] IEEE European LV Test Feeder files (optional) (P7.6)

---

## Golden-value notes

All golden values are produced by the engine as it stood at commit `69ac75a` (before any change in
this programme). On 2026-10-20 every row of the brief's golden table was re-derived from that
untouched engine and matched exactly at the stated decimals — no discrepancies.

**Tolerance convention** (brief: "±0.01 on the stated decimals unless noted"): a value stated with
2 or more decimals is asserted to ±0.01; a value stated with 1 decimal is asserted to ±0.05 (half a
unit in the last stated place, i.e. it must still round to the stated figure); integers (iteration
and violation counts, move counts) are exact; explicit tolerances in the brief (e.g. "±0.5") are
used as given. See `client/src/lib/__tests__/helpers.js`.

**Full-precision lock.** In addition to the brief's table, `client/src/lib/__tests__/fixtures/reference.json`
holds the untouched engine's raw float output for a spread of snapshots (Walkthrough Island
unbalanced and balanced, several hours and years, a grounded-pole variant that exercises the nodal
neutral solve, a ZIP-load variant, a BESS variant and a two-transformer variant). `reference.test.js`
asserts every number to 1e-9. This is the gate P1.4 asks for ("bit-for-bit identical within 1e-9")
and catches drift long before it would show in the 2–3 decimal goldens. It is regenerated only by
`npm run gen:reference`, which must never be run to "fix" a failing test — only after a
deliberate, documented result change.

### Deliberate golden changes

**P1.3 fix 1 — hosting reported untested sizes (2026-10-20).** The old binary search rounded its
best *tested* size to the nearest 0.05 kVA, so it could report the step above anything it had
tested. On the balanced fixture, several of those reported sizes **fail** a full load flow (e.g.
4.70 kVA at P2B produces a violation at the solar shoulder; so does 40.05 kVA at P1C with nothing
else committed). The brief's prescribed `Math.floor(best*20 + 1e-9)/20` alone would also have
dropped every capped 5.00 to 4.95, because the bisection never tests the cap itself (it stops at
4.9902). So `searchMaxKva` (engine/hosting.js), shared by PV and BESS, (1) tests the cap first
and reports it if it passes, (2) otherwise floors the best passing size (the brief's formula),
and (3) tries the next 0.05 step once, keeping it only if it passes. Every reported size has now
passed a full load flow or lies below one that has (monotonic feasibility, as the binary search
already assumed). Values that changed (all others in the table, including P3B 2.70, the capped
5.00s, BESS 45.00 and the P3B loss score 17.05, are unchanged):

| Golden | Was | Now |
|---|---|---|
| `computeHostingCapacity(balanced)` P2B | 4.70 | 4.65 |
| … total | 42.40 | 42.35 |
| `computeSystemHostingCapacity(balanced)` total | 111.75 | 111.65 |
| … P1C independent/achievable | 40.05 / 40.05 | 40.00 / 40.00 |
| … P2C | 22.25 / 5.10 | 22.20 / 5.10 |
| … P2A | 21.50 / 9.10 | 21.50 / 9.05 |
| … P3C | 13.85 / 1.00 | 13.80 / 1.05 |
| … P3A | 13.30 / 0.30 | 13.25 / 0.35 |
| … P1B | 9.35 / 9.35 | 9.30 / 9.30 |
| … P2B | 4.70 / 4.70 | 4.65 / 4.65 |
| `computeSystemBessHostingCapacity(balanced)` total | 69.80 | 69.95 |
| … daily loss with BESS | 25.46 kWh | 25.47 kWh |

(The queue order is unchanged. Some downstream achievable amounts *rise* — P3C, P3A — because
the corrected, smaller upstream commitments leave more headroom.) The new values are asserted in
`golden.hosting.test.js` with the old ones alongside as comments. The non-hosting goldens and the
1e-9 reference lock are untouched by this fix.

---

## Decisions and assumptions

- **Phase 0 / withDefaults.** The old-format test needs `withDefaults`, so a minimal version was
  added in P0.2 (in `loadflow.js`; it moves to `engine/model.js` in P1.1). It wraps
  `normalizeDesign`, then fills in any missing scalar setting from `defaultDesign()`, defaults
  missing collections (`poles`, `loads`, `pv`, `bess`, `openPoints`) to empty arrays, and fills
  per-transformer `txGroundOhms` (7.5 Ω, the solver's own fallback) and per-pole
  `grounded`/`groundOhms`. It never overwrites a value that is present.
  - *Behaviour note:* `DesignContext.loadDesign` and the JSON import used to do
    `{ ...defaultDesign(), ...normalizeDesign(d) }`. For a design missing an array field (e.g. no
    `pv` key), that silently injected the *sample* network's PV/loads into it. `withDefaults`
    defaults missing arrays to `[]` instead. Designs that have all their arrays (every design saved
    by this app) load identically.
  - `withDefaults` is called at the load boundaries (server load, JSON import, fresh design), not
    inside `runSnapshot`, so the solver's hot path is untouched.
- **Lint scope.** ESLint 9 flat config in `client/`. Engine files (`src/lib/loadflow.js`, and later
  `src/lib/engine/**`) are linted with ES globals only (no `window`/`document`) and a
  `no-restricted-imports` rule that allows relative imports only — this enforces rule 3 (pure,
  dependency-free engine) mechanically. `no-unused-vars` is a warning, not an error, so CI isn't
  blocked by pre-existing unused imports; they're reported for cleanup.
- **CI Node version.** CI uses Node 22 (current LTS line, matches local dev). The Dockerfiles still
  use `node:20-alpine`; Node 20 reached end-of-life in April 2026. Not changed in Phase 0 (it
  touches the deployed images) — raised as an open question.
- **ESLint 9** prints an npm "no longer supported" deprecation notice (ESLint 10 is current).
  `eslint-plugin-react` support for ESLint 10 is the deciding factor; kept on 9 for now. Revisit
  when convenient — it doesn't affect the app.

## Item notes

What each completed item did, and the decisions taken along the way.

**P1.1 engine split (2026-10-20).** `loadflow.js` was sliced into `engine/*.js` by line range,
not retyped. A script asserted that every non-blank source line landed in exactly one module (the only
lines dropped were two section banners, which each module replaces with its own header). Then
JSDoc was inserted above signatures. The only edits to code lines are: `export` added to 7
formerly-internal names that another module now imports (`netS`, `zipMultiplier`, `loadKvaAt`,
`pvKvaAt`, `PHASE_ANGLE`, `HOSTING_TEST_HOURS`, `UNCAPPED_CEILING_KVA`); the two hosting loops
iterate `PHASES` instead of an identical literal `['A','B','C']`; and JSDoc type casts. All 51
previous `loadflow.js` exports are still exported (checked by script) and the 1e-9 lock passes.
`npm run typecheck` (TypeScript 5.7, `checkJs`, ES libs only, non-strict) is clean and runs in CI.

**P1.2 libraries (2026-10-20).** `defaultDesign()` (and so `withDefaults` for older designs) now
seeds `conductorLibrary` and `transformerLibrary` with deep copies of the built-in `CONDUCTORS` /
`TRANSFORMERS`, which are now frozen. Every engine lookup goes through `getConductor` /
`getTransformerType` / `conductorParams` (design library first, built-in fallback), as do the
Setup, Network, Feeder Split and Reports pages and the report. Decisions:
- A saved design carries its own copy of the equipment data, so its results don't silently change
  if the built-in table is ever corrected. The built-ins remain the fallback for any code a
  design's library lacks.
- `conductorParams` also accepts explicit `X`, `Rn`, `Xn` on an entry (used as given), ready for
  the P2.5 editor. For the two built-ins it reproduces the old `condX`/`condRn`/`condXn`
  arithmetic exactly.
- An unknown conductor code or transformer rating now throws a clear error. It used to be a
  `TypeError` inside the solver.
- The per-rating no-load table (`design.txNoLoadW`) keeps precedence over the library's `noLoadW`,
  as before.
- The Network page's conductor pickers list the library codes (`70ABC`) instead of the
  hard-coded "70 ABC" labels.

**P1.3 fix 2 — baseline-relative hosting (2026-10-20).** Hosting candidates are judged against the
design's own violations at the same test hour (`hostingBaseline`, `newOrWorsenedViolation` in
engine/hosting.js). A candidate fails on a new pole + phase + type, or on a pre-existing violation
getting more than 0.01 worse (V for voltage, percentage points for thermal / transformer
loading). Decisions:
- **The baseline is the original design**, with no committed additions, even inside the
  simultaneous queue. This is the conservative reading: the 0.01 tolerance can't creep as
  additions accumulate.
- **The BESS baseline uses the same charge/discharge relevance filter as the candidates.**
- **The Hosting and BESS pages list the baseline in a banner** (`BaselineBanner.jsx`), and so do
  the report's hosting sections.

Effect: on the balanced fixture the baseline is clean at every test hour, so no golden changed.
On a test island with a 20 kVA shop on P3-A, the old search reported zero PV and zero BESS
everywhere. It now finds 5 kVA of PV at P1A, P2A and P3A (PV on P3-A relieves the undervoltage).
It still rejects PV on the B/C phases, because by neutral shift that deepens the P3-A
undervoltage by more than 0.01 V. That is the criterion working as specified, not a bug.

**P1.3 fix 3 — non-convergence (2026-10-20).** An unconverged snapshot now fails a hosting size
(checked before its violations, which can't be trusted). On a test island with ±1000 % limits,
1000 kVA of PV at P3-B fails to converge yet raises no violation, so the old search walked all the
way up to the 2000 kVA ceiling. Each hosting row (independent and queue) now carries `limit`
(`'cap' | 'violation' | 'nonConvergence'`) and `limitDetail` (the binding violation and its hour,
or the hour that didn't converge). The pages show this as "Limited by". Non-convergence warnings
were added to Hosting, BESS Hosting, Feeder Split (candidate rows, quick result, preview), Load
Balance (before/after metrics, preview) and Diagram; Reports and Daily already had them. No golden
changed.

**P1.3 fix 4 — true transformer current (2026-10-20).** `runSnapshot`'s transformer summary
gains `phaseCurrentA` (|Itot| per phase), and `summarizeScan` adds `txMaxPhaseCurrentA` (worst phase
over the scanned hours) next to the unchanged balanced-equivalent `peakCurrentA`. On the unbalanced
Walkthrough Island the worst phase carries 121.3 A against a 54 A balanced-equivalent estimate.
Feeder Split and Load Balance now show "Tx max phase current: TX 121 A (bal.-eq. 54 A)". No golden
changed.

**P1.3 fix 5 — AI model (2026-10-20).** `ANTHROPIC_MODEL` (`server/src/config.js`, default
`claude-sonnet-4-6`, still a valid current model ID). Blank counts as unset. Compose passes
`${ANTHROPIC_MODEL:-}`. Server unit tests now exist (`npm test` in `server/`, `node:test`, no
dependencies) and run in CI. Notes for P7.7:
- **SDK.** The route still uses raw `fetch`. When it becomes a tool-using loop, move it to the
  official `@anthropic-ai/sdk`.
- **Thinking and `max_tokens`.** Newer models (Opus 5.5, Sonnet 5.5, Fable) always think, and
  thinking counts against `max_tokens` (1000 today). Switching models via the env var may need a
  larger value; this is noted in `.env.example`.
- **Refusals.** A `refusal` stop reason currently shows as "No response received."

**P1.4 performance (2026-10-20).** The structural changes are bit-identical, and the 1e-9 lock
passes on its cold path:
- injections hoisted out of the iteration loop;
- `connectionIndex` and `topologyOf` maps;
- a factor-once neutral solve.

Results now carry phasors (`poleResults[].vph`, `transformers[].busVph`). `runSnapshot(design, opts,
ctx)` takes `ctx.initialV`, built with `warmStartFrom(previousResult)`. Scans warm-start hour to
hour by default, and `warmStart: false` reproduces the cold values exactly. The PV and BESS
searches warm-start each hour from the baseline, then from the last converged evaluation.

Measured on the fixtures and the 50-pole feeder: warm vs cold max |ΔV| was 6.3e-4 V, with zero
violation-count changes across 32 scans. The reference lock checks the warm path at 1e-3 for
every scan case. Every golden is unchanged.

Decisions and caveats:
- **Grounded subtrees always start flat.** A warm start with cold neutral potentials measured
  slower there.
- **Warm starts can converge where a flat start doesn't.** In a limit-free test island (±1000 %),
  the warm-started search reaches ~978 kVA of PV at P3-B, a size whose cold snapshot doesn't
  converge. With real limits a violation stops the search long before that region. The fix-1
  tests confirm this by re-checking every reported size with cold-start load flows. P4.3's
  α = 0.3 retry should close the gap.
- **The connection index is per snapshot (or per scan), not cached per design object.** A cache
  keyed on the object would go stale if anything mutated a design in place.
- **Not done: inlining complex arithmetic.** It would avoid object allocation but risks changing
  floating-point operation order. Not needed: the budget is met with a wide margin.

**P1.5 Web Worker (2026-10-20).** How it fits together:
- **Task registry.** `lib/engineTasks.js` holds `ENGINE_TASKS` (named tasks returning plain data)
  and `handleEngineMessage` (the protocol: throttled `progress`, then one `result` or `error`).
- **Worker.** `workers/engine.worker.js` is three lines that connect the registry to the port.
- **Client.** `lib/runInWorker.js` starts one worker per task. Cancel is `terminate()`, so the
  engine needs no cancellation checks. Aborting rejects with `AbortError`.
- **UI.** `hooks/useEngineTask.js` and `components/TaskProgress.jsx` (a determinate bar plus
  stage text, Cancel, and the cancelled/error outcome) are used in both themes.
- **Engine.** The long functions take an optional `{ onProgress }`.
- **Dual-feeder search.** The staged search moved from the page into
  `searchDualFeederSplit`, and a test shows it equals the page's original loop.

On the worker now:
- PV and BESS hosting, both independent and simultaneous;
- Feeder Split (single, dual, at the open point);
- the Load Balance proposal;
- the three 24 h scans;
- building the comprehensive report (`downloadHtml` / `reportFileName` split out of
  `downloadReport`; the download itself stays on the main thread).

Single snapshots (~4 ms: Reports, Diagram, previews) stay on the main thread. Leaving a page cancels
its running task. Load balancing v2 and Monte Carlo will use the same mechanism when they arrive
(P4.1, P4.4).

**P2.1 VUF (2026-10-20).** `engine/sequence.js` (`sequenceComponents`, `vufPct`). The results
gain:
- `poleResults[].vufPct` and `transformers[].busVufPct`;
- `worstVuf` and `vufLimitPct` per snapshot;
- in `summarizeScan`, `worstVuf` (with hour and year) and `unbalanceViolationCount`.

`design.standards = { vufLimitPct: 2, vufAsViolation: false }`. `withDefaults` now fills setting
groups field by field (`DESIGN_SETTING_GROUPS`), so later standards fields reach older designs.

Finding: on Walkthrough Island at 20:00, P3's VUF is 1.70 % (balanced: 0.74 %). That's below
EN 50160's 2 %, even though P3's phase-to-neutral voltages span 212.9–239.2 V. Most of that spread
is neutral shift, which is zero sequence and correctly excluded from VUF. So the phase-to-neutral
band check, not VUF, is what bites on this feeder. No golden changed.

**P2.2 profile data (2026-10-20).** `engine/profile.js`: `distanceFromTx`, and
`voltageProfile(result, design, { feederRoot | path })`. Each profile is one series per
root-to-leaf path (a branch shows as its own line), starting at the LV bus at 0 m. A `path` that
doesn't follow parents outwards is rejected with a clear error. The UI comes in P5.3.

## Phase verification log

**Phase 1 (2026-10-20).**
- **Checks.** `npm run lint` (0 problems), `npm run typecheck` (0 errors), `npm test` (173 tests in
  13 files), `npm run build` (the worker is bundled as its own 41 kB chunk), and in `server/`,
  `npm test` (4 node:test tests) plus `node --check` on every file. All pass on Node 22.
- **Browser click-through** (headless Edge, `/api` mocked, run against both the Vite dev server
  and `vite preview` of the production build, 12/12 checks each):
  - PV hosting via the worker shows the new goldens (42.35 kVA; P2B 4.65 "limited by overvoltage
    at P3 B, 11:00"; simultaneous 111.65 kVA).
  - The 50-pole feeder shows determinate progress ("Testing each pole and phase — 22 of 150").
  - The worst animation-frame gap during a search was 17 ms (the UI never blocked).
  - Cancel stops the run and re-enables the button.
  - The dual-feeder search (64 joint candidates), 24 h scan, report download and load-balance
    proposal all complete through the worker.
  - The progress UI fits 390 px in the dark theme with no horizontal scroll, and there were no
    console errors.

**Phase 0 (2026-10-20).** `npm ci`, `npm run lint` (0 errors, 0 warnings), `npm test` (8 files,
92 tests), `npm run build`, and `node --check` on all 6 server files, all passing locally on
Node 22. UI click-through: Vite dev server driven by headless Edge (Playwright), with `/api`
mocked so an **old-format** Walkthrough Island (flat `txRating`, no `transformers[]`, BESS, open
points or grounding) arrives through the real `DesignContext.loadDesign` path. The running Docker
stack and the database were not touched. Results:
- Load and JSON import of the old format both work, with no sample BESS/open-point rows injected.
- Setup shows the migrated TX (100 kVA, tap 2, 10 800 V, X/R 3, Rg 7.5 Ω).
- Run & Reports at 20:00 shows P3 212.9 / 239.2 / 235.6 V and 1 voltage violation (golden).
- Load Balance shows 9 moves and 3 → 0 violations over 24 h (golden).
- Feeder Split ranks P3, P2, P1 (golden).
- Diagram, 24h Profile, both hosting pages, AI Insights and About all open; the dark theme works.
- At 390 px width, Run & Reports has no horizontal overflow.
- The only console error is a 404 for `/favicon.ico`: the app has no favicon, which predates this
  work. Icons come with the P7.8 PWA manifest.

## Open questions for the user

1. Docker images run Node 20, which is end-of-life. OK to move both Dockerfiles to `node:22-alpine`
   (would happen alongside P7.1, when both images are rebuilt anyway)?
2. `walkthrough/` (containing `walkthrough-island.json`) is untracked. It matches the test fixture
   exactly (checked). Should it be committed (e.g. as `docs/walkthrough/`), or left out of git?
3. **Hosting goldens changed (P1.3 fix 1).** Several hosting values in the brief's golden table
   (e.g. balanced P2B 4.70 kVA, system P1C 40.05 kVA) fail a full load flow. The corrected values
   are in "Golden-value notes" above. Please confirm you accept the new values; I've updated the
   golden tests and kept the old ones alongside as comments.
4. **Hosting baseline (P1.3 fix 2).** Candidates are compared against the *original* design's
   violations, even inside the simultaneous queue (the conservative reading). Comparing against
   "original + already-committed additions" would let tolerance accumulate. OK to keep it this way?

## Performance log

`npm run bench` (client) — synthetic 50-pole / 200-connection island (`syntheticFeeder()`), Node 22,
this dev machine. "Before" = untouched engine at `6326123`, captured before any Phase 1 change.

| Case | Before (6326123) | After P1.4 | Speed-up |
|---|---|---|---|
| Snapshot, 50 poles / 200 conn, 20:00 (41 iterations) | 11.3 ms | 3.6 ms | 3.2× |
| Snapshot, same with 8 grounded poles (21 iterations) | 11.0 ms | 4.3 ms | 2.5× |
| `runDailyScan` (24 snapshots) | 231 ms | 51 ms | 4.5× |
| `runDailyScan`, grounded | 210 ms | 61 ms | 3.4× |
| `scanAndSummarize` (24 h) | 226 ms | 49 ms | 4.6× |
| `proposePhaseBalance` | 0.26 ms | 0.30 ms | — |
| Walkthrough Island snapshot (3 poles) | 0.35 ms | 0.16 ms | 2.2× |
| `computeHostingCapacity`, 50 poles × 3 phases | 17.3 s | 6.5 s | 2.6× |

Where the time went:
- Hoisting `netS` out of the iteration loop and replacing per-pole list filters with
  `connectionIndex` took the snapshot from 11.3 to 4.2 ms.
- Eliminating the grounded neutral matrix once per solve (`factorComplexSystem`, replaying the
  identical row operations per iteration) took the grounded snapshot from 7.5 to 4.4 ms.
- Warm starts add about 15 % on scans and about 37 % on hosting searches.

The 50 ms snapshot budget is met with a wide margin. A 24 h scan is now about 50 ms on this machine,
but slower client hardware can push it past the 100 ms UI rule, so scans still move to the worker in P1.5.
