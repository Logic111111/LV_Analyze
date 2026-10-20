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
- [x] **P2.3** Fault level & protection check (`faults.js`, IEC 60909-style; fuse library empty by default; Protection panel + report section)
- [x] **P2.4** Tap advisor (multi-year, ranking, unbalance diagnosis, off-load note, Apply/Preview)
- [x] **P2.5** Editable conductor library + reconductoring advisor
- [x] **P2.6** Fix-it ladder (combined solution advisor)
- [x] **P2.7** Standards profiles (`design.standards`; "Current app defaults" profile reproduces today exactly)

## Phase 3 — Advanced modelling (all off by default)

- [x] **P3.1** Smart-inverter PV (volt-var / volt-watt / export limit; IEEE 1547-2018 Cat B seed curves, labelled)
- [x] **P3.2** BESS with state of charge (`schedule` default; `socSchedule` / `solarFollowing`)
- [x] **P3.3** Transformer thermal ageing (IEC 60076-7)
- [x] **P3.4** HV voltage profile (`hvProfile`, default all 1.0)
- [x] **P3.5** Coupled line model (4×4 matrices, behind a flag)

## Phase 4 — Optimisation and mathematics

- [x] **P4.1** Phase balancing v2 (impedance-weighted / load-flow objectives, local search, Pareto table, seeded SA)
- [x] **P4.2** Voltage sensitivity matrix
- [x] **P4.3** Solver robustness (diagnostics, α=0.3 retry, collapse detection)
- [x] **P4.4** Probabilistic (Monte Carlo) planning
- [x] **P4.5** Multi-criteria view for feeder split and fix-it ladder

## Phase 5 — UI/UX

- [x] **P5.1** New single-line diagram (`SingleLineDiagram.jsx`, IEC 60617-style, overlays, before/after, SVG/PNG/PDF/DXF export)
- [x] **P5.2** Interactive what-if (drag a drop to another phase; sensitivity preview, confirmed by full load flow)
- [x] **P5.3** Engineering charts (V vs distance, phasor diagram, heatmap, loading-duration, VUF, fault level)
- [x] **P5.4** Scenario manager and comparison
- [x] **P5.5** Issues panel
- [x] **P5.6** "Explain this number" drawer
- [x] **P5.7** Map-based network editor (react-leaflet, configurable tiles, haversine "measured vs entered")
- [x] **P5.8** Guided new-design wizard
- [x] **P5.9** Report upgrade (new sections, print stylesheet, sign-off block, optional logo)
- [x] **P5.10** Internationalisation & accessibility (`t()`, en default, Sinhala/Tamil machine drafts)

## Phase 6 — Data and economics

- [x] **P6.1** Economics (loss cost, discount rate, cost table → LKR/yr, capex, payback, NPV)
- [x] **P6.2** Demand from billing data (Velander, fitted from CSV)
- [x] **P6.3** Smart-meter (AMI) import
- [x] **P6.4** Measured vs simulated (incl. phase-label check)
- [x] **P6.5** Fleet dashboard (`designs.summary` JSON column)
- [x] **P6.6** Exports (xlsx, CSV, GeoJSON)

## Phase 7 — Platform

- [x] **P7.1** Shared engine package (`packages/engine/`)
- [x] **P7.2** Database migrations (numbered SQL, `schema_migrations`)
- [x] **P7.3** Version history and undo/redo
- [x] **P7.4** Teams, roles and approval workflow
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

**P2.3 fault levels and protection (2026-10-20).** The new code:
- **`engine/faults.js`:** `faultSettings`, `sourceImpedance`, `faultLevels`, `protectionDevices`
  and `protectionCheck`. The brief's goldens are reproduced exactly (c = 1, 20 °C, infinite source).
- **New design fields** (filled by `withDefaults`): `fault` (`hvFaultMVA` null, `hvXR` 10,
  `cMax` 1.05, `cMin` 0.95, `condTempC` 80), `fuseLibrary` (empty), `protection`
  (`feederFuses` keyed `"<txId>|<feeder>"`, `poleFuses`), and `standards.disconnectTimeS` (5).

Decisions:
- **Pole fuse placement.** A "fuse at pole X" sits at the upstream end of the span into X and
  protects X and everything downstream. Its breaking-capacity fault level is taken at X's parent,
  and its first span (for Iz) is the span into X.
- **Protection zones.** A device's zone stops at the next downstream fuse, so the head fuse
  doesn't have to clear faults beyond a section fuse.
- **Load check (c)** uses the year-0 24 h scan. With several root spans under one head fuse, it
  adds their per-phase peak magnitudes (a conservative upper bound).
- **Source impedance.** `Zq` uses `cMax` for both fault cases (IEC 60909). The min-fault loop
  includes the full `Zq`, per the brief's formula; strictly ⅔·`Zq` through a Dyn11, so this errs
  low on Ik1min, the conservative side. Earth-return paths are ignored, also conservative.
- **Fuse data.** Nothing is invented. Every check needing a missing number is "data missing".
  The tests use one fuse entry clearly labelled as fictitious.

UI: a new Protection tab (fault-level table, fuse library editor, head and section fuse positions,
and the check run through the worker), a fault-settings card on Setup, and a report section.

**P2.4 tap advisor (2026-10-20).** `tapAdvisor(design, txId, { horizon | years, hours })`. Only the
chosen transformer's poles are judged.
- **Margin:** the minimum over pole, phase, hour and year of the distance to the nearer limit
  (negative means outside the band).
- **Violation count:** pole-phase-hours outside the band, per year.
- **Diagnosis order:** first the worst single-hour spread between the highest and lowest phase
  voltage, compared with the band width (unbalance: balance first). Then the overall
  min-to-max range (a fixed tap can't cover both ends). Then tap-step granularity.

Goldens as specified: unbalanced → tap 2 with the unbalance diagnosis (31.7 V spread at
19:00, year 5, against a 27.6 V band); balanced → tap 2, with taps 3/4 rejected. The UI is a card
on Setup (worker task `tapAdvisor`), and the latest result goes into the report via
`lastTapAdvice` and `buildReportHtml(…, extras)`.

**P2.5 conductor library and reconductoring (2026-10-20).** Library entries may carry `label`,
`R`, `X` (or `|Z|` for the built-ins), `Rn` or `neutralScale`, `Xn`, `I`, `costPerM` (LKR) and
`notes`. `conductorIssues` lists missing electrical data; only complete entries are offered
(`usableConductorCodes`). The built-ins' electrical values are locked in the UI. IEC 60228 class-2
Al R20 maxima for 16–240 mm² (`IEC60228_AL_R20_OHM_PER_KM`) are a hint for R only.

`reconductorAdvisor(design, { years, hours, maxCandidates })`. Decisions:
- **Ranking count.** Rankings use voltage + thermal violations (reconductoring relieves both).
  Each count is also reported separately.
- **Cost ranking.** Within a tier of equal violations, candidates sort by capex only if every
  candidate in the tier has a cost; otherwise by kWh, shown as "cost unknown". A tier is
  all-or-nothing so the ordering stays transitive.
- **Default years.** The engine defaults to `[0]`, which the brief's golden uses. The page defaults
  to years 0 and 5.

The golden is reproduced (P3 → 70ABC: 2 violations, 18.10 kWh, 214.84 V). With only the two
built-ins, that is the Walkthrough Island's single option. **Waiting on data:** more conductor
sizes and costs.

**P2.6 fix-it ladder (2026-10-20).** `fixItLadder(design, { years, order, stopAtFirst })`. The
default order is `LADDER_STEPS`. Success means 0 voltage violations (pole-phase-hours) in every
checked year.

How each step is built:
- **balance:** `proposePhaseBalance` per transformer, applied in sequence.
- **tap:** the tap advisor's recommendation per transformer.
- **reconductor:** the reconductor advisor's top-ranked option.
- **split:** the feeder (tree) with the most baseline violations, split by the top
  `computeFeederSplitCandidates` option. The new transformer copies the type of the one feeding it
  (rating, tap, HV, X/R, earth), is sited at the cut, and any connector uses the
  lowest-resistance usable conductor.
- **combinations:** chain their two parts, so the second runs on the result of the first.

A step with nothing to change reports a note and no design. The golden is as specified (stops at
balance, 9 moves, 0/0, 19.16 → 13.29). Running every step on the fixture also shows split (14.56
kWh) and balance + reconductor (12.86 kWh) fix it, while tap and reconductor alone don't.
LKR/yr waits for P6.1. kWh/yr = daily × 365.

**P2.7 standards profiles (2026-10-20).** `engine/standards.js`. `design.standards` gains
`profileName`, `cableLoadingLimitPct` (100) and `txLoadingLimitPct` (100). The voltage band stays
in `design.vnom` / `vdev`, which a profile writes. Two built-in profiles ship, each with its
source stated: "Current app defaults" and "EN 50160 supply voltage" (230 V ±10 %, VUF ≤ 2 %
counted; EN 50160 sets no loading limits, so those stay at 100 %).

User profiles are stored in the browser (`localStorage`); the limits applied are stored in the
design. Shared organisation profiles are deferred to P7.4. The disconnection time moved from the
fault card to the Standards card. Under the defaults, results are bit-identical (the 1e-9 lock
passes).

**P3.1 smart inverters (2026-10-20).** `engine/inverter.js` plus `design.inverter` (`mode`,
`voltVarCurve`, `voltWattCurve`, `exportLimitKw`), with an optional `pv.inverterMode` override.
In `netS`, unity units with no export limit stay constant injections (bit-identical). Every other
unit is a "smart" injection evaluated each iteration at its own phase voltage, and a 3-phase unit
is three single-phase thirds.

Decisions:
- **Reactive priority** within the rating (IEEE 1547-2018 default for volt-var).
- **Export limit** caps each PV unit's P. There's no customer-load netting, because a PV system
  isn't linked to a particular load connection in the model.
- **Hosting candidates** behave under the design's inverter mode.

**Waiting on data:** the local grid code's inverter settings. The Cat B seed is marked as a
placeholder in the UI.

**P3.2 BESS SOC (2026-10-20).** `engine/bessDispatch.js` (`simulateBessDay`, `bessParams`,
`socBessUnits`), with new per-unit BESS fields `mode`, `kWh`, `socInitial` / `socMin` / `socMax`
(0.5 / 0 / 1) and `etaCharge` / `etaDischarge` (√RTE). `netS` takes a `bessDispatch` map. The
SOC-aware day simulation feeds:
- `runHours` (and so every scan and advisor), simulating from 00:00 to the last hour asked for;
- `runSnapshotAt`, used by every page snapshot;
- the hosting baselines, which hold the base-day dispatch fixed while candidates are tried.

Decisions:
- **Solar-following charging.** It decides from a solve of that hour with the following units
  idle (transformer exporting), or from local PV exceeding local load (nameplate × curves, the
  same quantities `netS` uses). Charging is at rated power, limited by SOC headroom.
- **SOC limits default to 0–1.** No reserve is assumed.
- **kWh is never assumed.** A SOC-mode unit without it is idle and flagged `dataMissing`.
- **The fixed schedule keeps the historical discharge-side RTE derate.** The SOC modes instead
  apply the efficiencies to stored energy.

**P3.3 thermal ageing (2026-10-20).** `engine/thermal.js` (`simulateHotSpot`,
`transformerAgeing`, `ageingRate`, `thermalSettings`) plus `design.thermal`.
- **Method:** 1-minute steps, the hourly K from the scan's |S| / rating (direction ignored,
  because heating doesn't care), and the day repeated until it is periodic.
- **Defaults:** x 0.8, y 1.6, R 5, k11 1, k21 1, k22 2, τo 180 min, τw 4 min, Δθor 55 K,
  Hgr 23 K (98 °C at rated load and a 20 °C ambient).

**Caveat:** the rises Δθor and Hgr are unit-specific heat-run values, and the UI asks for them.
**Waiting on data:** the site ambient profile (the flat 20 °C IEC reference is flagged in the UI
and the report) and heat-run values where available.

**P3.4 HV profile (2026-10-20).** `tx.hvProfile`, read through `hvMultiplierAt` (anything missing
or invalid counts as 1.0). Decision: `withDefaults` doesn't add an all-1.0 array to every
transformer. The accessor's default is the migration, and it keeps saved designs and the
transformer comparisons in existing tests unchanged. Snapshots report `hvMultiplier`; the fault
calculation uses `vnom` and isn't affected. **Waiting on data:** the HV voltage profile.

**P3.5 coupled line model (2026-10-20).** `engine/lineModel.js` (`parseZMatrix`,
`couplingMatrix`, `diagonalZMatrix`), plus `design.lineModel` (`'simple'` by default) and
`conductor.zMatrix`.
- **Exact equality.** The forward pass sums `ΔV` from zero term by term, the neutral current is
  negated exactly, and diagonal-loss terms use the same `|I|²·R` expression. So a diagonal matrix
  from today's values is **bit-identical** to the simple model (tested with `toEqual`).
- **Neutral scaling.** The neutral self term uses the same 1 cm-floored length as the simple
  model's `Zn`.
- **Limitation:** grounded subtrees don't carry coupling into the nodal neutral solve. They keep
  the uncoupled model and are listed in `couplingIgnored`.

No geometry is assumed. Matrices come from the user. The test matrix with mutual terms is labelled
test-only.

**P4.1 phase balancing v2 (2026-10-20).**
- **Code.** `engine/advisors/phaseOptimiser.js` (`optimisePhaseBalance`, `pathImpedanceOhm`,
  `BALANCE_OBJECTIVES`, `LOADFLOW_OBJECTIVE_WEIGHTS`) and `engine/random.js` (`mulberry32`,
  `randomInt`, shared with P4.4). The Quick method (`proposePhaseBalance`) and its golden values are
  unchanged.
- **UI.** Load Balance page → Method: Quick / Optimised. The Pareto table runs in the worker, and
  any row can be previewed and applied through the existing preview.
- **Move count.** Moves are counted physically. Connections identical apart from id and phase are
  interchangeable, so an arrangement's move count is the minimum number of drops to re-terminate.
  Swapping two identical ADMD loads is not a move and is never proposed.
- **Never worse than Quick.** The Quick proposal is seeded into the candidate pool, so Optimised is
  never worse than Quick at the same move count (that is what makes "K = 9 ≤ legacy" hold in
  general, not only on the fixture).
- **Monotone by construction.** Each K's row is the best with ≤ K moves found so far.
- **Load-flow objective weights** (optimisation weights, not engineering data; overridable):
  - 1 MW-equivalent per voltage violation-hour;
  - neutral I²R in W, summed over hours;
  - 1 kW per % VUF above the profile limit, per pole and hour.

  Only the transformer's own subtree is solved. That is exact, because subtrees are independent.
- **Screening.** Above 200 neighbours per step (large transformers), only the 200 best by
  impedance-weighted spread are solved. The fixture is searched in full.
- **Fixture results** (24 h):
  - Load-flow objective: 0 violations from K = 1. Objective 163 at K = 8 versus 1777 for Quick's
    9 moves.
  - Impedance objective: K = 9 equals Quick (0.058).
  - Nameplate objective: K = 8 reaches Quick's 1.0 kVA spread.

**P4.2 voltage sensitivity (2026-10-20).** `engine/sensitivity.js`: `voltageSensitivity`,
`predictVoltages`, `phaseMoveChanges`, `linearHostingEstimateKw`. `transformerSubDesign` moved to
`model.js` and is shared with P4.1. `runSnapshot` gains `extraS` (constant-power test injections,
load convention); with none, nothing changes. It is checked against equivalent unity-pf PV
within 1e-9.
- Central differences, ±0.5 kW and ±0.5 kvar: four solves per pole-phase, each warm-started from
  the base case.
- Result layout: one block per transformer, rows are injections and columns are observed
  voltages. Cross-transformer terms are exactly zero.
- SOC-BESS dispatch is simulated once and held fixed.
- Accuracy on the fixture: ±1 kW / ±1 kvar at all 9 pole-phases at 20:00 and 12:00, worst
  linear-prediction error 7.7 mV (test bound 0.2 V).
- Speed: the 50-pole feeder takes 1.4 s, so it runs in the worker.
- Hosting page: "Instant linear estimate (12:00)" — voltage limits only, labelled as a first
  look. The full search, which the goldens cover, is unchanged and remains the confirmation.

**P4.3 solver robustness (2026-10-20).** In `solver.js`:
- **Diagnostics.** `res.convergence[]` per transformer: `{ txId, status, retried, deltaHistory }`.
  `res.status` is `'converged' | 'not-converged' | 'collapse'`.
- **Retry.** A pass that exhausts MAX_ITER (150) is retried once with α = 0.3 (same back-off
  rule) from its lowest-ΔV iterate. That iterate is recovered by replaying the deterministic first
  pass from its saved start, not by copying state each iteration. Copying cost ~60 % on every
  solve. Separately, a single `{ ...V }` spread made the whole solve ~50 % slower in V8, so the
  start state is copied entry by entry.
- **Bench unchanged:** snapshot 3.8 ms, daily scan ~55 ms, hosting ~6.5 s.
- **Collapse.** Status `'collapse'` means any |V| < 0.5·vnom, a non-finite voltage, or ΔV at the
  end of the retry above its start. A settled solution below 0.5·vnom is the low-voltage branch
  of the P–V curve and also counts.
- **Hosting/BESS.** Searches treat `'collapse'` as a limit of its own: "voltage collapse
  (hh:00)", checked before non-convergence.
- **Goldens.** No golden changes: every golden case converges on the first pass.
- **Changed behaviour (P1.3 fix-3 tests updated).**
  - In the deliberately limit-free island, 1000 kVA at P3-B used to end "not converged". The
    retry now solves it and flags it `'collapse'` (minimum 18.9 V).
  - The precondition test now uses 1500 kVA, which is still not converged after 300 iterations.
  - That island's PV search now stops at `'collapse'` rather than `'nonConvergence'`.
- **UI.** `SolveStatusWarning` on Diagram and Run & Reports; collapse hours on Daily; the HTML
  report states voltage collapse in words.

**P4.4 Monte Carlo (2026-10-20).**
- **Code and page.** `engine/monteCarlo.js` (`monteCarloStudy`, `adoptionSizesFromDesign`,
  `runMetrics`, `quantile`, `histogram`, `MC_CRITICAL_HOURS`); page **Probabilistic**
  (`/app/monte-carlo`, worker task `monteCarlo`).
- **Eligible customers and placement.** Eligible customers are `general` loads. Each run adopts
  exactly round(% × customers), uniformly without replacement, independently for EVs and PV. The
  new unit takes the customer's own pole and phase. Existing EVs and PV are kept.
- **Sizes are never invented.** They are a discrete {kVA, weight} list, defaulting to the
  design's own EV loads and PV units. Adoption with an empty list is refused ("data missing").
- **EV / solar switched off.** If EVs or solar are off in Setup but adoption is asked for, they
  are switched on for the study and the page says so.
- **Hours.** The default is the critical hours, 12:00 and 20:00; the full day is selectable.
- **Losses.** Reported over the scanned hours. They equal daily losses only in full-day mode,
  and are labelled that way.
- **Determinism.** One seeded mulberry32 stream for the whole study, so the same seed gives
  identical results. At 0 % adoption every run equals the base scan exactly (tested).
- **Speed.** About 34 ms per run on the 50-pole feeder at the critical hours: 500 runs ≈ 17 s in
  the worker.
- **Charts.** The heatmap prints the probability in every cell, so it does not rely on colour.
  `lib/chartTheme.js` and `components/ChartCanvas.jsx` now hold the chart palette and canvas,
  shared with Daily and reused by P5.3.

**P4.5 multi-criteria view (2026-10-20).**
- **Component.** `components/MultiCriteriaView.jsx` and `lib/pareto.js` (`dominates`,
  `nonDominatedIndices`, `sortRows`), shown under the Feeder Split and Fix-it Ladder results.
- **The advisors' own lexicographic ranking is untouched.** The view adds:
  - a table sortable by any criterion (`aria-sort`; a third click returns to the advisor's order);
  - a "non-dominated" column;
  - a scatter of any two criteria (violations, kWh, capex, worst VUF). Non-dominated options are
    triangles and the rest circles, so shape as well as colour tells them apart.
- **Capex is not invented.**
  - Ladder: only reconductoring with user-entered conductor costs has a capex.
  - Feeder split: capex has no data until P6.1.
  - Missing values are shown as "—" and skipped in the dominance test, with the reason printed.
- **Engine.** `ladderMetrics` gains `worstVufPct`, the max over checked years and hours (tested).

**P5.1 single-line diagram (2026-10-20).**
- **Architecture.** `lib/sld/scene.js` → `buildSldScene(design, res, { overlays, faults,
  protection, compareTo })` returns plain primitives (line, polyline, polygon, rect, circle, arc,
  text) with colour *tokens*. Every output renders this one scene:
  - `components/SingleLineDiagram.jsx` (live SVG);
  - `lib/sld/svg.js` (standalone SVG with a title block; PNG through a canvas; print/PDF through a
    hidden iframe, A3 landscape);
  - `lib/sld/dxf.js` (ASCII DXF R12, AC1009: LINE, CIRCLE, ARC and TEXT only, one layer per
    element type and per drop phase). Dashes are drawn as segments, so no linetype table is
    needed, and text is ASCII-only.

  The layout is tested without a browser: a test asserts that no two labels from different
  elements overlap, on the fixture and on the 50-pole feeder with every overlay on.
- **Symbols (IEC 60617 style).**
  - HV source: a circle with "~", showing S"k or "not set".
  - Transformer: two circles, with rating, Dyn11 and tap.
  - LV busbar and feeder fuse (rectangle with the conductor through it).
  - Pole node, outlined in its voltage status. Earth electrode: a stem and three bars.
  - Open point: dashed line.
  - Drops in A/B/C (and 3φ) groups. Every drop label starts with its phase letter; a group header
    shows the phase voltage and "!" when outside the band. Markers: load ▲, EV ▲ with a bar,
    PV a square with a diagonal, BESS two plates. "*" marks ADMD.
- **Layout.** A pole sits level with its first child; further branches go downwards, and each
  pole's drop block is reserved before the next branch starts. The drawing scrolls inside its
  frame. The initial zoom fits the width but never goes below 85 %.
- **Diagram page.**
  - SLD by default; the old drawing is the "Simple view".
  - The hour slider and multipliers re-solve live: debounced 250 ms, in the worker (task
    `snapshotAt`).
  - Overlays: voltage, loading %, power flow, VUF, fault level (`faultLevels`), protection
    (`protectionCheck` via the worker).
  - Elements are keyboard-selectable buttons with aria-labels; the side panel shows full details.
  - Exports carry a title block with the design, date and snapshot, plus the prepared / checked /
    approved names and dates. These are stored in the new `design.signOff` (defaulted to blanks in
    `withDefaults`) and reused by the report in P5.9.
- **Before/after in all five advisor previews** (`components/SldPreview.jsx`):
  - moved drops are boxed, with an arrow from a dashed ghost in the old phase;
  - upgraded spans are 5 px with "old→new" conductor;
  - a new transformer is dashed, and re-fed spans are marked;
  - a tap change is shown as "tap a → b".

**P5.2 interactive what-if (2026-10-20).**
- **Gesture.** On the SLD, drag a single-phase drop onto another phase group of the same pole.
  The keyboard route is the side panel's "→ A / B / C" buttons; hover or focus previews, click
  applies. Three-phase connections are not draggable.
- **Preview.** While over a target, the diagram shows voltages predicted from the P4.2 sensitivity
  matrix of the solved snapshot. The matrix is computed in the worker on first use and cached per
  solve. The P and Q moved come from the new engine helper `connectionPowerAt`, which matches netS
  injections to 1e-12 (tested).
  - Smart-inverter PV counts at its available power.
  - SOC-BESS counts as idle; the confirming load flow handles both.
- **Confirmation.** On release the move is applied to the design, and the live load flow re-solves
  it. A "What-if moves" card lists before / preview / load-flow voltages and the largest preview
  error.
  - Browser check: 0.38 V for the 7 kVA EV, A → B at 20:00.
  - Unit test: within 0.5 V.
- **Undo.** Local Undo on the page, one move at a time. P7.3 adds the global undo/redo stack.
- **Drag bug fixed.** Native text selection auto-scrolled the frame mid-drag and dropped onto the
  wrong phase. The SVG is now `user-select: none`, and pointer-down cancels the default action.

**P5.3 engineering charts (2026-10-20).**
- **Page.** **Charts** (`/app/charts`), built on `lib/chartData.js` (`phasorData`,
  `voltageHeatmap`, `loadingDuration`, `vufByPole`, `faultAlongFeeder`; unit tested).
  - One worker 24 h scan feeds every chart; the hour slider picks the snapshot for the profile,
    phasor and VUF charts.
  - Every canvas has an aria-label, and the key numbers are printed beside it. The heatmap prints
    the value in every cell.
- **Engine addition.** `poleResults[].vn`, the complex neutral shift of the local neutral relative
  to the transformer star point. It takes the nodal solve's `Vn − VnTx` for grounded subtrees;
  otherwise it accumulates Zn·In (or the coupled matrix's neutral row) span by span.
  - Reported only: every golden, the reference lock and the benchmark are unchanged.
  - Tested: at P1 |vn| = |Zn|·In; the shift grows outwards and shrinks after balancing.
  - Fixture at 20:00: 9.24 V ∠2.6° at P3.
- **Phasor diagram.** O = star point, N′ = local neutral. N′→tip are the customers' voltages, and
  O→tip the phase-to-star voltages. An enlarged inset shows O→N′, which is tiny next to 230 V.

**P5.4 scenarios (2026-10-20).**
- **Code.** `engine/scenarios.js`: `designPatch`, `applyPatch`, `describePatch`, `applyScenario`,
  `patchCapex`, `scenarioMetrics`, `compareScenarios`, `SCENARIO_ROWS`, `CURRENT_DESIGN_SCENARIO`.
- **Data.** `design.scenarios` is a new collection, `[]` by default in `withDefaults`. A scenario
  holds:
  - overrides: year, multipliers, taps per transformer, built-in standards profile;
  - a `patch`: changed or added items by id, and removed ids, per collection.

  Applying a patch to the base gives the variant back exactly; tested for balance, reconductor
  and split.
- **Decision.** A patch keeps its own copy of each changed item. Later edits to the same items in
  the base are overridden while the scenario is applied. The page says so.
- **UI.**
  - Every before/after preview has **Keep as scenario**.
  - The **Scenarios** page edits, duplicates, deletes and "Apply to design…" (with a confirm
    dialog). It compares up to 4 scenarios, optionally including the current design, in the
    worker.
  - The best value in each row gets ★ plus bold, not just colour.
- **Capex.** Derivable only for re-strung spans priced with user conductor costs. Moves, new
  transformers and tap changes are listed as needing costs; P6.1 fills these from the cost table.
- **LKR/yr** needs `economics.lossCostLkrPerKwh` (P6.1).
- **Browser check:** keeping the balance preview as a scenario and comparing it shows violations
  3 → ★ 0.

**P5.5 issues panel (2026-10-20).**
- **Engine.** `engine/issues.js` → `collectIssues(design, daily, protection)`, `issueCounts`,
  `LONG_SPAN_M = 60`.
  - Violations are grouped per location, with the worst value and hours. The fixture's 3
    undervoltage pole-phase-hours are one issue, P3 A.
  - Severities:
    - error: a statutory or rating limit broken, collapse, non-convergence, incomplete conductor
      data, an orphan pole;
    - warning: VUF above the limit while not counted as a violation, protection data missing,
      no fuse data, a span longer than 60 m;
    - info: HV fault level not set (infinite-bus assumption).
- **Panel.** `components/IssuesPanel.jsx` sits in the app shell. Counts are written out with
  icons; the drawer has filters and closes on Escape. It is rebuilt in the worker (task `issues`)
  800 ms after each change.
- **"Suggest fix"** routes are pre-filtered by URL: `fix-it?tx`, `load-balance?tx` (preselects the
  transformer), `feeder-split?root` (preselects the feeder), `reconductor?pole`, `protection?device`,
  `diagram?hour&pole` (opens that hour and selects that pole), and `setup?section=fault|conductors`
  (scrolls past the sticky header).
- **Header.** No longer sticky at ≤ 720 px: with 18 tabs it covered much of a phone screen.

**P5.6 explain drawer (2026-10-20).**
- **Engine.** `engine/explain.js`: `explainPoleVoltage`, `explainSpanLoading`, `explainSpanLoss`,
  `explainTxLoading`, `explainFault`, `explainVuf`, `explainHosting` (fed by the new
  `traceHostingSearch` in `hosting.js`).
- **Pole voltage.** V = V0 − Z_T·I_T − Σ(R+jX)·L·I_ph − Σ ΔV_N, where each ΔV_N is the rise of the
  local neutral (`vn`, P5.3). This one form covers ungrounded, grounded (nodal neutral solve) and
  coupled-model subtrees. Each term's in-phase part is shown as its share of the magnitude drop.
- **Tests.** Every trace equals the reported figure:
  - pole voltages within 1e-3 V on all 9 pole-phases, grounded and coupled included (P3 A
    212.862 V);
  - span loading and loss, transformer loading, fault currents vs `faultLevels`, VUF;
  - the hosting trace's result equals the Hosting page row.
- **Engine additions** (reported only, no other number changes): `poleResults[].icum` (complex
  span currents) and `transformers[].itot`. `findMaxPV` takes an optional trace array; the same
  check function runs either way.
- **UI.** `components/ExplainDrawer.jsx` is a modal dialog: focus moves to Close, Escape closes,
  and focus returns to where it was.
  - The SLD side panel has "Explain" buttons on phase voltages, VUF, span loss and loading,
    transformer loading and fault level.
  - Each Hosting row has "Explain", which runs the traced search in the worker.

**P5.7 map editor (2026-10-21).**
- **Geometry.** `engine/geo.js`: `haversineM` (R = 6 371 008.8 m), `measuredSpans`,
  `acceptMeasuredSpans`, `hasCoords`. Optional `lat`/`lng` on transformers and poles; a test checks
  that coordinates never change results.
- **Map settings.** New `design.map` settings group, defaulted in `withDefaults`:
  OpenStreetMap tiles with attribution, and an initial view of Sri Lanka used only when nothing is
  placed.
- **Page.** `pages/MapPage.jsx` (tab "Map") uses **Leaflet 1.9.4 (BSD-2) directly**.
  **react-leaflet was not used:** it and @react-leaflet/core are under the Hippocratic License 2.1
  (not OSI-approved, with use restrictions). See the open questions.
- **Modes.**
  - Select / drag to move.
  - Place the selected item.
  - Add a pole fed from the selected item. The length is measured from the parent; the conductor
    and feeder come from the parent.
  - Connect to a new parent; a loop is refused.
- **Customers.** Phase-lettered chips at each pole (EV / PV / BESS subscripts).
- **Measured vs entered.** The table applies measured lengths only on "Use measured", with a
  confirm when they differ by more than 100 %; ⚠ marks differences over 10 %.
- **Keyboard route.** Number fields for latitude and longitude, plus the Network table.
- **Performance.** Every page is now a lazy chunk: main bundle 703 → 215 kB; Leaflet loads only
  with the Map page.
- **Browser check.** Tiles are mocked. Place TX and P1, use measured, add P4: all pass, with no
  horizontal scroll at 390 px.

**P5.8 wizard (2026-10-21).**
- **Code and route.** `lib/wizard.js` (`generatePoles`, `generateCustomers`, `buildWizardDesign`,
  `validateWizard`, `initialWizard`, unit tested) and `pages/WizardPage.jsx` (`/app/wizard`).
  Linked from Designs ("New design wizard…") and Setup.
- **Steps.**
  1. Transformer: library ratings, tap, HV, X/R, Rg.
  2. Feeders: each is a radial chain, then an editable pole table.
  3. Customers: per pole, rotated A→B→C or on one phase; ADMD when kVA is blank.
  4. PV and EV: user-entered counts and sizes; with no size, no units are created.
  5. Review: a quick check at 20:00 and 12:00, then Create.
- **Inline validation.**
  - Errors block Create: a rating not in the library, a span ≤ 0, a conductor with missing data,
    a PV or EV count without a size.
  - Warnings: spans over 60 m, no customers, connected ADMD above the transformer rating, more
    PV/EV than customers.
- **Context.** `newDesign(built)` now accepts a built design; it still goes through `withDefaults`.

**P5.9 report upgrade (2026-10-21).**
- **Added.**
  - A table of contents.
  - A sign-off block (`design.signOff`, shared with the diagram title block).
  - An optional logo: `design.logo`, PNG/JPEG/SVG up to 100 kB, inside the server's 600 kB body
    limit. Only `data:image/(png|jpeg|svg+xml);base64,…` is rendered (tested).
  - The SLD as inline SVG.
  - Scenario comparison and Monte Carlo sections, fed by `lastScenarios` / `lastMonteCarlo` in
    DesignContext.
  - An Economics section: "not set" until P6.1, which fills it.
  - An Optimisation section slot for O7.
- **Already present from earlier items:** VUF, fault and protection, tap, reconductor, fix-it,
  inverter, SOC and thermal ageing.
- **Print CSS.** `@page A4`, `print-color-adjust: exact`, headings kept with their content,
  repeating table heads.
- **UI.** A "Report options" card on Run & Reports holds the logo upload and sign-off fields.
- **Browser check.** The downloaded report contains the TOC, SVG, sign-off and print CSS; the
  print rendering was checked visually.

**P5.10 i18n and accessibility (2026-10-21).**
- **i18n.**
  - `src/i18n/i18n.jsx` provides `I18nProvider`, `useT`, `useI18n`, `translate`, `LANGUAGES`.
    Dictionaries are `en.json` / `si.json` / `ta.json`.
  - Keys are the English text, so unextracted or missing strings fall back to English.
  - The language switch sits in the top bar and is stored in localStorage `fi-lang`; it also sets
    `<html lang>`.
  - Sinhala and Tamil are **machine drafts** (`_meta.status`). A banner says so in both the
    language and English. They are listed under "waiting on data" for native-speaker review.
- **Extracted so far (78 keys):** navigation, top bar, issues panel, task progress, SLD toolbar
  and overlays, wizard steps and buttons, page headings, common buttons.
  - **Gap:** long explanatory hints and engineering table text are still English-only. The
    mechanism is in place, so extraction can continue page by page without code changes.
  - Tests guard this: key parity, placeholders preserved, and every literal `t('…')` in the source
    present in `en.json`.
- **Accessibility audit.** axe-core 4.10 (WCAG 2.1 A + AA) on all 19 tabs, light and dark:
  **0 violations**, down from 23 (contrast and missing labels). Fixes:
  - Light-theme `--accent` / `--good` / `--warn` / `--bad` darkened to teal-700 / green-800 /
    amber-800 / red-700, so they pass 4.5:1 as text and on their tinted pills.
  - aria-labels on inline-edit controls.
  - A skip link (first focus stop), a labelled main navigation, `main#main`, focus-visible
    outlines, and named chart canvases.
  - Scope: the audit covers each page's initial state. Result panels added since (SLD, explain
    drawer, dialogs) were built keyboard-first and checked by hand.

**P6.1 economics (2026-10-21).**
- **Engine.** `engine/economics.js`: `economicsOf`, `capexOf`, `npv`, `optionEconomics`.
- **Data.** `design.economics` is a settings group, all `null` by default.
  - Inputs: loss cost LKR/kWh, discount %, study years, rewire LKR per move, tap-change LKR,
    transformer LKR by rating.
  - Conductor LKR/m is `costPerM` in the conductor library.
  - Nothing is defaulted. Missing inputs make the dependent figures `null`, which the UI shows as
    "not set" with a tooltip naming the input.
- **Formulas.**
  - Annual kWh = daily × 365 (one representative day; stated in the UI and report).
  - Simple payback = capex / LKR saved per year.
  - NPV = −capex + Σ_{t=1..N} saving/(1+r)^t, with end-of-year savings.
  - Hand-checked: 100 000 capex, 20 000/yr, 10 %, 10 yr → 22 891.34.
- **Where shown.**
  - Fix-it ladder columns (browser check: rebalance → 107 089 LKR/yr, capex 27 000, payback
    0.3 yr, NPV 631 018).
  - Scenario rows for saving, payback and NPV against the current design at the same year and
    multipliers.
  - The report's Economics section.
  - `patchCapex` (P5.4) now uses `capexOf`.

**P6.2 Velander (2026-10-21).**
- **Engine.** `engine/velander.js`: `velanderSettings`, `velanderPeakKva`, `basePeakKva`,
  `fitVelander`, `parseVelanderCsv`.
- **One source for ADMD.** `basePeakKva` is now the single place that substitutes ADMD: in
  `loadKvaAt`, the BESS "PV exceeds local load" rule, `feederConnectedTotals` and phase balancing.
  Its order is: entered kVA, then the Velander peak for a general connection with annual kWh when
  the option is on, then ADMD. With the option off, everything is bit-identical (tested;
  goldens pass).
- **Fit.** Least squares on [W, √W] with no intercept, as in the formula, via the 2×2 normal
  equations. Tested:
  - exact recovery on noise-free data;
  - residuals orthogonal to both basis columns;
  - R² against the mean;
  - refusal of fewer than 2 points or all-equal W.

  The test constants are labelled test-only. **No default constants.**
- **UI.**
  - Setup → "Demand from billing data (Velander)": enable, k1/k2, CSV paste or upload, fit,
    R², residuals with outliers > 2×RMS in bold, "Use these constants". It warns when the option
    is on but constants are missing.
  - Network: per-load "Annual kWh" and "Meter id" (for P6.3).

**P6.3 smart-meter import (2026-10-21).**
- **Engine.** `engine/ami.js`: `parseWallClock`, `parseAmiCsv`, `amiAnalysis`,
  `applyAmiSuggestions`, `AMI_TYPES`.
- **Data.** CSV of meter id, `YYYY-MM-DD[ T]HH:MM`, kWh per interval. The interval is
  configurable (default 30 min), and kW = kWh × 60/interval. Timestamps are local wall-clock with
  no time-zone conversion.
- **Mapping.** Meters map to connections through the new `meterId`; the Network column came
  with P6.2. Unmatched meters and meterless connections are listed.
- **Suggestions.**
  - Per-type normalised curve: mean hourly demand ÷ its own max, optionally weekday/weekend.
    Hours with no data are reported, and an incomplete curve can't be applied.
  - Per-customer peak.
  - Group ADMD = coincident peak of the summed demand ÷ customers ÷ pf (kVA).
  - Applied only for the ticked items, after a confirm.
- **Tests.** Hand-computed figures on synthetic data.

**P6.4 measured vs simulated (2026-10-21).**
- **Engine.** `engine/fieldReadings.js`: `parseFieldCsv`, `compareMeasured`, `FLAG_V = 3`.
- **Comparison.** Error = measured − simulated, with bias, MAE and RMSE; |error| > 3 V is flagged.
  An optional current is compared with the span current into that pole.
- **Phase-label heuristic.** A flagged reading whose best other phase has |error| ≤ ⅓ of its own
  and is at least 2 V smaller is marked "likely recorded on phase X". The page states this rule
  and calls it a prompt for a site check.
- **Page.** **Field data** (`/app/field-data`) holds the AMI card and this one; it runs in the
  worker (task `compareMeasured`).
- **Note.** The P6.3 commit carried the engine only. The index export and page landed here, so
  the P6.3 commit on its own doesn't expose `ami.js` through `loadflow.js`.
- **Browser check.** Matched meters: ADMD applied after a confirm. A P3 "phase A" reading at
  B's voltage is flagged as a likely phase-B record.

**P7.2 migrations and server restructure (2026-10-21; done before P6.5, which needed it).**
- **Runner.** `server/src/migrate.js` applies `server/sql/migrations/NNN_name.sql` once each, at
  start-up and before the app listens.
  - A `schema_migrations` table records what has run.
  - `GET_LOCK` stops two instances racing.
  - Each migration runs in `START TRANSACTION … COMMIT` together with its version row.
  - **MySQL commits DDL implicitly**, so statements carry `-- @skip-if-(column|table|index|fk)-exists`
    guards checked against information_schema; an interrupted migration can simply be re-run.
- **Schema.** `schema.sql` stays the fresh-install base: Docker initdb, then the migrations.
  Existing databases are upgraded in place. Migrations:
  - 001: summary columns.
  - 002: `design_versions`; existing designs become version 1.
  - 003: organisations, memberships, design org/status/locked version, reviews, audit_log.
  - 004: sessions.
- **Server structure.** `createApp({ repo })` (`src/app.js`). All SQL lives in `src/repo/mysql.js`
  (parameterised; multi-statement changes in transactions), and the access rules in
  `src/access.js`. Routes: auth, designs, orgs, ai. Every route requires auth and checks ownership
  or role.
- **Tests.** supertest + node:test on an in-memory repo (`test/memoryRepo.js`), 16 server tests:
  - migration runner with a fake connection;
  - 401 on every route;
  - sessions;
  - ownership (404 for others' designs);
  - versions, restore, duplicate;
  - payload limits;
  - organisations;
  - the full workflow.

  The server image now ships `sql/`, and CI runs `npm ci` for the server (lockfile added).
- **Not yet verified against a real MySQL:** the throwaway-stack Docker check at the end covers
  that.

**P6.5 fleet dashboard (2026-10-21).**
- **Summary.** `engine/summary.js` `designSummary` (tested) is computed in the worker on each save
  (`saveDesign`), sent as `__summary`, and stored by the server. A summary over 8 kB is dropped.
  - The worst voltage is whichever extreme is furthest from nominal. On the fixture that is 212.5 V
    at P3 A 19:00, the day's minimum; 212.9 V is the 20:00 golden snapshot.
- **Dashboard page.** Lists own and organisation-shared designs with search, a status filter,
  sortable columns, and a "worst first" view (most violations, then the furthest from nominal).
- **Gap.** The hosting total is the sum of the last independent hosting scan when one was run in
  the session.

**P6.6 exports (2026-10-21).**
- **Code.** `lib/exports.js`: `designTables`, `toCsv`, `toXlsx`, `toGeoJson`.
- **Excel.** Built with **exceljs 4.4.0 (MIT)**, which is lazy-loaded (938 kB chunk only on
  export; main bundle 228 kB). One sheet per table, read back in tests.
- **CSV.** RFC 4180 with a BOM on download. Available from the Exports card (any table) and as
  buttons on the dashboard, hosting, scenario, Monte Carlo, field-data and phase-balance tables.
- **GeoJSON.** WGS 84 [lon, lat]: transformer and pole points with results, span and open-point
  lines; unplaced items are counted and left out.
- **Browser check.** The .xlsx downloads as a valid zip, and the CSV header is correct.

**P7.1 shared engine package (2026-10-21).**
- **Move.** `client/src/lib/engine/` → `packages/engine/` with `git mv` (history kept), as package
  `@feeder-island/engine` (pure ESM, `sideEffects: false`). Paths named in earlier notes now
  live there.
- **Client.** A Vite alias plus the `file:../packages/engine` dependency (npm links it, so Node
  scripts resolve it). `src/lib/loadflow.js` re-exports it, so the public API is unchanged
  (imports test). `server.fs.allow: ['..']` lets the dev server serve the package.
- **Lint and types.**
  - `npm run lint` = the client pass, then `eslint -c client/eslint.engine.config.js
    packages/engine` from the repo root. ESLint ignores files outside its base path, hence the
    second pass. The purity rule was proven by planting a `react` import in the package.
  - `tsconfig.engine.json` includes the package.
- **Server.** `src/engine.js` → `loadEngine()`, a dynamic `import()` from CommonJS; tested on the
  golden fixture (P3 A 212.9 V).
- **Docker.**
  - Both images build from the repo root (compose `context: .`), with `.dockerignore`.
  - Node 22 (alpine). The server copies `packages/engine` to `/app/packages/engine`, the same
    relative path as in the repo, and runs as `node`. The client build installs the `file:`
    dependency.
  - The image build and a throwaway-stack check are in the final verification.

**P7.3 version history and undo/redo (2026-10-21).**
- **Server.** From P7.2: `design_versions`; each save is a version (and, via migration 002,
  existing designs become v1). Routes: versions list/get, restore (a new version), duplicate.
- **Client.**
  - `VersionHistoryCard` on Designs: notes, author, date; the 🔒 approved version.
  - A field-level diff (`lib/designDiff.js`, tested) of a version against the open design or the
    previous version.
  - Restore, Duplicate, and a "Version note" field on save.
- **Undo/redo.** `lib/history.js` (pure, tested).
  - Every `setDesign` goes through it, applied proposals included.
  - Edits less than 600 ms apart form one step, so typing is one undo; 100 steps are kept;
    load and new reset it.
  - Top-bar ↶/↷ buttons, plus Ctrl/⌘+Z and Shift+Ctrl/⌘+Z / Ctrl+Y outside text fields (where
    the browser's own text undo applies).
- **End to end.** Real API (in-memory repo) plus browser: undo/redo, versions with notes, diff
  shows "Pole P3 changed: spanM 60→75", restore, duplicate — all pass.

**P7.4 teams, roles and approval (2026-10-21).**
- **Server** (from P7.2): organisations, memberships with roles, `designs.org_id`, status and
  locked version, `design_reviews`, `audit_log`; routes `/api/orgs*` and `/api/designs/:id/{share,
  submit,approve,reject,reviews}`.
- **Access rules** (`src/access.js`):
  - read: the owner or org members;
  - edit: the owner or org designer/admin, never while submitted;
  - submit: needs an organisation, from draft or rejected;
  - reject: reviewer, approver or admin;
  - approve: approver or admin, **not the submitter** (four-eyes — my addition, the conservative
    reading);
  - an edit to an approved design keeps the approved version locked and reopens as a draft.

  Every route answers 404 for designs and organisations the user can't see. supertest covers all
  of it.
- **Client.** `TeamsCard` (organisations, members, roles, audit log) and `WorkflowCard` (share,
  submit, approve, reject with a required comment, history); the saved designs list shows status
  and organisation.
- **End to end (3 users).** Org and roles; share and submit; the reviewer has no Approve and
  rejects; resubmit; the approver approves (v1 locked); the admin sees the audit log — all pass.

## Phase verification log

**Phase 4 (2026-10-20).**
- **Checks.** Lint, typecheck, the full client suite, the build and the server tests all pass
  (counts in the final summary). Every golden and the 1e-9 reference lock are unchanged.
- **Browser** (headless Edge against the Vite dev server, `/api` mocked, all checks pass):
  - Load Balance → Optimised: a 10-row Pareto table plus the Quick reference row. Preview of
    K = 3 draws the diagram, and Discard returns to the same table.
  - Solar Hosting → instant linear estimate.
  - Probabilistic: 60 runs, with the probability heatmap and 4 histograms.
  - Fix-it Ladder and Feeder Split: multi-criteria tables sort, mark non-dominated options and
    draw the scatter. The split figures still match the goldens (14.56 / 17.14 / 21.88 kWh).
  - At 390 px, Probabilistic and Load Balance have no horizontal page scroll. The histograms
    overflowed at first; fixed with `minWidth: 0` on the grid cells.
  - No console errors; 16 tabs.

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

- **react-leaflet licence.** The brief names react-leaflet, but it (and @react-leaflet/core) is
  licensed under the Hippocratic License 2.1, which is not an OSI open-source licence and restricts
  some uses. The map editor uses Leaflet's own API (BSD-2) instead, with identical behaviour.
  Switching to react-leaflet later is easy if your organisation accepts that licence.

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

`optimisePhaseBalance`, Kmax 9, no annealing, without the per-row metrics scans:

| Case | Time | Arrangements evaluated |
|---|---|---|
| Walkthrough Island (20 connections), nameplate | 55 ms | 274 |
| Walkthrough Island, load-flow objective, 24 h | 1.2 s | 486 |
| 50-pole feeder (190 connections), nameplate, 24 h | 4.0 s | 5 003 |
| 50-pole feeder, impedance-weighted | 5.1 s | 10 663 |
| 50-pole feeder, load-flow objective, 1 hour | 15.7 s | 2 868 |

All of these run in the worker with progress and Cancel. On large transformers the UI hint
recommends the night-peak or solar-peak test conditions for the load-flow objective.

Where the time went:
- Hoisting `netS` out of the iteration loop and replacing per-pole list filters with
  `connectionIndex` took the snapshot from 11.3 to 4.2 ms.
- Eliminating the grounded neutral matrix once per solve (`factorComplexSystem`, replaying the
  identical row operations per iteration) took the grounded snapshot from 7.5 to 4.4 ms.
- Warm starts add about 15 % on scans and about 37 % on hosting searches.

The 50 ms snapshot budget is met with a wide margin. A 24 h scan is now about 50 ms on this machine,
but slower client hardware can push it past the 100 ms UI rule, so scans still move to the worker in P1.5.
