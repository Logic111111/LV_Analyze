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
- [ ] **P1.3** Bug fixes (each with a test that fails before the fix)
  - [ ] 1. Hosting rounds up to an untested size (`Math.round` → `Math.floor(best*20+1e-9)/20`)
  - [ ] 2. Pre-existing violations zero out hosting — baseline-relative feasibility + banner
  - [ ] 3. Non-converged load flow counts as a pass in hosting/BESS — treat as infeasible; surface non-convergence on every scanning page
  - [ ] 4. Feeder-split transformer current assumes balance — add `txMaxPhaseCurrentA` (true max phase current), show balanced-equivalent as secondary
  - [ ] 5. AI model hard-coded — `ANTHROPIC_MODEL` env var (default `claude-sonnet-4-6`), documented in both `.env.example`
- [ ] **P1.4** Performance — precompute per-pole `loadS`/`otherS` once per snapshot, `connectionsByPole` index, optional warm start (`initialV`), `npm run bench` (50 poles / 200 connections), before/after timings recorded here
- [ ] **P1.5** Web Worker infrastructure — `engine.worker.js`, `runInWorker(task, args, {onProgress, signal})`, progress bar + Cancel on every long action

## Phase 2 — Engineering analyses

- [ ] **P2.1** Symmetrical components & VUF (phasors kept in results; per pole/hour + worst over 24 h; `'unbalance'` violation only when `design.standards.vufAsViolation`)
- [ ] **P2.2** Voltage-profile data — `distanceFromTx`, `voltageProfile`
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

No golden value has changed.

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

## Phase verification log

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

## Open questions for the user

1. Docker images run Node 20, which is end-of-life. OK to move both Dockerfiles to `node:22-alpine`
   (would happen alongside P7.1, when both images are rebuilt anyway)?
2. `walkthrough/` (containing `walkthrough-island.json`) is untracked. It matches the test fixture
   exactly (checked). Should it be committed (e.g. as `docs/walkthrough/`), or left out of git?

## Performance log

`npm run bench` (client) — synthetic 50-pole / 200-connection island (`syntheticFeeder()`), Node 22,
this dev machine. "Before" = untouched engine at `6326123`, captured before any Phase 1 change.

| Case | Before (6326123) | After P1.4 |
|---|---|---|
| Snapshot, 50 poles / 200 conn, 20:00 (41 iterations) | 11.3 ms | — |
| Snapshot, same with 8 grounded poles (21 iterations) | 11.0 ms | — |
| `runDailyScan` (24 snapshots) | 231 ms | — |
| `runDailyScan`, grounded | 210 ms | — |
| `scanAndSummarize` (24 h) | 226 ms | — |
| `proposePhaseBalance` | 0.26 ms | — |
| Walkthrough Island snapshot (3 poles) | 0.35 ms | — |
| `computeHostingCapacity`, 50 poles × 3 phases | 17.3 s | — |

The snapshot is inside the 50 ms budget already; a 24 h scan (~230 ms) is not inside the "UI thread
never blocked > 100 ms" rule, so scans move to the worker in P1.5 regardless of P1.4 gains.
