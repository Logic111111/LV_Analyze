# LECO synthetic LV network, load estimator and NMD placement

Date: 2026-10-27. Branch: to be created (see section 12). Status: approved in conversation,
section by section; this file awaits review.

## 1. Goal and scope

Building an LV network model by hand needs data LECO does not have for every customer. About 60% of
customers have smart meters (and solar inverters) at known locations; the rest have only a monthly
bill. This work builds:

1. A **synthetic LECO LV network** of about 200,000 households across all 7 LECO branches,
   simulated in OpenDSS for one week. It stands in for reality: it is the "real data".
2. An **estimation model** in the app that sees only what LECO could observe (locations, smart-meter
   and inverter readings, bills, NMD readings), rebuilds the LV network, infers phases and estimates
   the unmetered customers' loads with uncertainty.
3. An **NMD placement optimiser** that says where along each feeder to put network monitoring
   devices so the estimate improves most.
4. **Pages** that show the whole LECO system, the estimator's accuracy and the NMD recommendations.

Users: a research demonstration now (accuracy against hidden truth is the headline), and LECO
planning engineers later, who will import real exports in the same format.

Out of scope (v1):

- Three-phase customers. Every customer is single-phase (stated as a generator assumption).
- Real road geometry (OpenStreetMap). Geography is synthetic around each branch town.
- In-browser re-estimation. Batch runs are command-line; pages show their results.
- A MySQL copy of the dataset. Datasets are files.
- Importers for specific LECO export formats. The `observed/` format (section 4) is the contract;
  a converter for a real format is written when a real file exists.
- Seasonality. One simulated week.

## 2. Decisions taken

| Question | Decision |
|---|---|
| What an NMD is | Network monitoring device: per-phase V, I, P, Q. One at every transformer LV board, others at poles along feeders. "Optimise the length" = choose the distance from the transformer. |
| Where "real data" comes from | The OpenDSS simulation of the synthetic network is the truth. The model sees only the observable part and is scored on the hidden part. |
| Horizon | 1 week, 30-minute intervals (336 steps). |
| What the model knows about topology | Transformer locations and every customer's location only. No transformer, pole or phase per customer. |
| Smart-meter channels | kWh import, kWh export, average voltage, every 30 minutes. Inverter kWh for PV customers. |
| Unmetered customers | Location, tariff category, monthly billed kWh. |
| Purpose | Both: demo on synthetic data now, real-data import path designed in. |
| Approach | A: Python + OpenDSS generator offline; JavaScript estimator in `packages/engine`; dataset as files served by the Express server; only scoring and NMD install read truth. |

## 3. Constraints found in the code and in public facts

- The engine (`packages/engine/`) is pure ES modules with no npm imports, JSDoc-typed, and runs in
  the browser, a Web Worker and Node. New estimator code follows the same rules
  (`client/eslint.engine.config.js`).
- Existing modules to reuse, unchanged: the 4-wire backward–forward sweep (`solver.js`, `scan.js`),
  AMI parsing (`ami.js`, `parseAmiCsv` for a future real-data converter), conductor and transformer
  libraries (`model.js`), the exact phase-balancing idea (dynamic programming over running totals),
  and `withDefaults` for "Open as design".
- OpenDSS is used today only as a dev cross-check (`scripts/validate-opendss.py`);
  `opendssdirect.py` is not installed. The generator stays a dev tool, not a runtime dependency.
- PROGRESS.md rule "no invented engineering/commercial data": every synthetic number is a labelled
  assumption in a config file, and every page shows a "Synthetic data" banner on synthetic datasets.
- Golden tests and the 1e-9 reference lock must not change. Existing engine modules are reused, not
  modified.
- LECO has 7 geographical branches: Kotte, Nugegoda, Moratuwa, Kalutara, Kelaniya, Negombo, Galle,
  and 588,879 consumers in 2019 (Wikipedia, "Lanka Electricity Company"). Per-branch customer
  counts and transformer counts were not found, so the branch split is an assumption. Branch town
  coordinates are looked up and cited in the config at implementation time.

## 4. Data contract

A dataset is a folder `data/leco/<datasetId>/` under `LECO_DATA_DIR` (gitignored; a Docker volume
in Compose). Binary files are little-endian Float32, entity-major: `[entity][step][channel]`, so one
entity's week is one contiguous read. Each `.bin` has a sidecar `.json` with
`{ ids: [...], steps: 336, channels: [...] }`. NaN marks a missing value.

### 4.1 `observed/` (what LECO could have; the real-data import contract)

| File | Content |
|---|---|
| `manifest.json` | `synthetic`, `datasetId`, `seed`, `startDate`, `intervalMin: 30`, `steps: 336`, `formatVersion`, NMD sets list, warnings. (The generator config copy lives in `truth/`, so nothing in `observed/` describes how the data was made.) |
| `branches.json` | `[{ id, name, lat, lon }]` |
| `transformers.json` | `[{ id, branchId, lat, lon, ratingKva }]` |
| `customers.json` | `[{ id, branchId, lat, lon, tariff: 'domestic'|'commercial', smart: bool, pvKwp?: number, billedKwhMonth?: number }]`. `pvKwp` for net-metered customers, `billedKwhMonth` for unmetered ones. No transformer, pole or phase. |
| `meters/<branch>.bin` | Smart meters; channels `kwh_in`, `kwh_out`, `v`. |
| `inverters/<branch>.bin` | PV inverters; channel `kwh_gen`. |
| `nmd-sets/<setId>.json` | `{ setId, createdAt, createdBy, devices: [{ nmdId, txId, kind: 'transformer'|'feeder', requested: {lat, lon}, installed: {lat, lon} }] }`. Immutable once written. |
| `nmd-sets/<setId>/<branch>.bin` | Channels `v_a, v_b, v_c, i_a, i_b, i_c, p_a, p_b, p_c, q_a, q_b, q_c`. For a feeder NMD, I, P and Q are the flow from the transformer side through that pole. |

The generator writes set `tx-only` (one NMD per transformer). A real dataset supplies its NMD sets
by import.

### 4.2 `truth/` (synthetic datasets only)

| File | Content |
|---|---|
| `network/<branch>.json` | MV feeders; per transformer: tap, poles `{id, lat, lon, earthed}`, spans `{id, from, to, lengthM, conductor}`, customers `{id, txId, poleId, phase}`. |
| `loads/<branch>.bin` | Per customer; channels `kw_gross`, `kvar`, `pv_kw`. |
| `voltages/<branch>.bin` | Per customer; channel `v`. |
| `flows/<branch>.bin` | Per span (span id = its downstream pole id); channels `p_a, p_b, p_c, q_a, q_b, q_c, i_a, i_b, i_c, v_a, v_b, v_c` (V at the span's downstream pole). Source of NMD readings at any pole. |
| `board/<branch>.bin` | Per transformer, the same 12 channels at the LV terminals (source of transformer NMD readings). |
| `losses/<branch>.bin` | Per transformer; channel `loss_kw` (LV network losses downstream of the terminals), for the self-check's energy balance. |
| `generator-config.json` | Exact copy of the config the dataset was generated with. |

### 4.3 `estimate/<runId>/` and `score/<runId>/`

- `estimate/<runId>/run.json`: estimator version and settings, NMD set, hidden-smart fraction and
  seed, timings, warnings.
- `estimate/<runId>/summary.json`: per branch and per estimated transformer key figures.
- `estimate/<runId>/tx/<txId>.json`: rebuilt network (poles, spans, feeders, length factors),
  customer assignments with confidence, phases with confidence, per-customer weekly kWh, peak kVA,
  weekday and weekend 24 h curves, unexplained energy, NMD recommendations (section 7).
- `estimate/<runId>/tx/<txId>.bin`: per unmetered customer; channels `kw_mean`, `kw_p10`, `kw_p90`.
- `score/<runId>/score.json`: metrics of section 6.5 for the system, per branch and per transformer.

### 4.4 The truth wall

- The estimator (engine modules under `packages/engine/leco/` except `score.js`, and
  `scripts/leco/estimate.mjs`) reads only `observed/`.
- Exactly three code paths read `truth/`: `score.js` via `scripts/leco/score.mjs`; NMD install
  (server, section 8), which copies a pole's flows into a new NMD set as a field crew's device
  would record them; and the server's truth-overlay route, which only displays.
- A Vitest test fails if any estimator module or the estimate CLI references `truth`.

## 5. Generator (`scripts/leco_synth/`)

Python 3 with `opendssdirect.py` and numpy only. Run:
`python scripts/leco_synth/generate.py --config scripts/leco_synth/config.json --out <dir>`.

### 5.1 Configuration (all values are assumptions, labelled in the file)

Households 200,000; branches all 7 with equal weights; smart share 0.6; PV share among smart
customers 1.0 (as requested; adjustable); tariff mix 0.95 domestic, 0.05 commercial; customers per
transformer 40–120; transformer ratings 100/160/250/630 kVA (the engine's built-in
`TRANSFORMERS` library, so "Open as design" needs no new library entry); transformers per MV
feeder 20–40;
feeders per transformer 2–4; pole spacing 30–40 m; service drop up to 35 m; conductor types and
impedances; transformer %Z and taps; household monthly energy lognormal (median and spread);
PV kWp lognormal; measurement noise and missing-data rates; month factor spread for bills; seed.

### 5.2 Geography and topology

Per branch, several neighbourhoods within a configured radius of the branch town: perturbed street
grids (random block sizes, some streets removed, rotation). Houses on both sides of streets.
Transformers each serve a contiguous area; neighbouring areas touch, so nearest-transformer
assignment is not reliably right. LV feeders follow streets as trees from the transformer: larger
conductor on trunks, smaller on branches. Single-phase customers go on phases with configured
imbalance. Transformers are grouped into MV feeders sharing a drifting MV voltage (random walk plus
drop along the feeder), so voltage correlation between neighbouring transformers is realistically
ambiguous.

### 5.3 Loads and solar

- Household load: the generator's own appliance and activity model (lighting, cooking, fans,
  refrigerator cycling, water pump, TV, AC for a configured fraction, iron) with an evening peak,
  scaled to each household's monthly energy draw. Commercial customers get a daytime model.
  Reactive power from a per-appliance power factor.
- Solar: clear-sky irradiance for each branch's latitude and date (numpy implementation), times a
  daily cloud factor correlated within a branch, times 30-minute variability, times kWp and a
  derate. Entered into OpenDSS as an injection.

### 5.4 Simulation

One OpenDSS circuit per transformer: stiff MV source following its MV feeder's voltage, Dyn11
transformer, 4-wire lines with neutral (as in `packages/engine/opendss.js`), earthed neutral at the
transformer and configured poles, one single-phase load per customer. 336 snapshot solves, results
read per step. Circuits run in parallel across CPU cores (`multiprocessing`). Estimate: about 2 h on
one core, about 20 min on 8.

### 5.5 Measurements

Smart meters: kWh with 0.5% noise, rounded to 0.01 kWh; voltage with ±0.5 V noise, rounded to
0.1 V; about 1% of intervals missing in bursts. Inverters likewise. NMDs: class 0.5 noise. Bills:
true weekly energy × 30/7 × a lognormal month factor, rounded to whole kWh.

### 5.6 Self-check (`scripts/leco_synth/selfcheck.py`, plain asserts)

On a 2-transformer dataset: OpenDSS source power equals loads plus losses at every step; customer
voltages within a sensible range; `observed/` JSON has no `txId`, `poleId` or `phase` key; binary
sizes match their sidecars.

## 6. Estimator (`packages/engine/leco/`)

Pure modules, JSDoc-typed, run by `scripts/leco/estimate.mjs <datasetId> [--nmd-set X]
[--hide-smart F --seed S]`. Settings live in `leco/defaults.js` (separate from the generator
config, which the estimator never reads).

### 6.1 Stage 1: transformer and phase per customer (`assign.js`)

- Smart meters: difference each voltage series (removes the shared daily shape), correlate with the
  differenced per-phase voltages of transformer NMDs within a radius; combine with a distance prior;
  best match gives transformer and phase; confidence from the margin over the runner-up.
- Unmetered: vote among the k nearest assigned smart meters plus a distance prior; confidence is the
  vote share.

### 6.2 Stage 2: rebuild the LV network (`topology.js`)

Group a transformer's customers into poles so each customer is within 35 m of its pole and poles
are about 30–40 m apart. Connect poles to the transformer with a minimum spanning tree on distance
× a detour factor. Subtrees at the transformer are feeders (merged to at most 4). Conductor by
downstream customer count from the conductor library. Calibrate one length factor per feeder by
1-D search, minimising the error between load-flow voltages (existing solver, stage 3 loads) and
measured smart-meter voltages.

### 6.3 Stage 3: unmetered loads (`profiles.js`, `estimate.js`, `phaseUnmetered.js`)

1. Smart customer gross consumption per interval = import − export + inverter generation. Gaps are
   filled from the same clock time on the meter's other days and flagged.
2. Typical patterns: k-means on normalised weekday and weekend daily shapes, per branch.
3. Prior for each unmetered customer: mix of the patterns of its nearest same-tariff smart
   neighbours, scaled to `billedKwhMonth / 30` per day; prior variance from those neighbours'
   spread.
4. Unmetered phases: the assignment that best explains the week's per-phase energy mismatch at the
   transformer NMD (metered by phase from stage 1), by dynamic programming over running per-phase
   totals; reported with confidence. Where ambiguous, measurement rows use phase probabilities.
5. NMD update per interval: each NMD's per-phase P equals metered net load downstream + unmetered
   downstream + losses (losses from load flow on the rebuilt network; two passes). Linear Gaussian
   update: posterior mean `μ + ΣHᵀ(HΣHᵀ + R)⁻¹(z − Hμ)`, posterior covariance
   `Σ − ΣHᵀ(HΣHᵀ + R)⁻¹HΣ`. Negative means are clipped to 0 and the interval renormalised to the
   measurement; the clip count is reported.
6. Power factor for unmetered customers from `defaults.js`; transformer NMD Q is reported against
   the estimate as a check, not fitted.

### 6.4 Outputs

Per section 4.3. **Unexplained energy** per transformer = NMD energy − (metered + estimated
unmetered + losses); a large value flags a wrong assignment, a topology error or unmetered usage.
`toDesign.js` turns an estimated transformer into a normal design (poles, spans, connections with
estimated peak kVA and curves) that passes `withDefaults` and solves.

Without any feeder NMD the estimator runs with the transformer NMD only and says so. Without any NMD
(possible in real data) it outputs priors only and says so.

### 6.5 Scoring (`score.js`, `scripts/leco/score.mjs <datasetId> <runId>`)

- Transformer assignment accuracy; phase accuracy (smart and unmetered separately).
- Total LV length error per transformer; feeder count match.
- Weekly energy error (MAPE) and interval kW error (normalised RMSE) for unmetered customers.
- Peak kVA error.
- 80% band coverage (target: truth inside the band about 80% of the time).
- Customer voltage error after load flow on the rebuilt network with estimated loads.

### 6.6 Tuning discipline

Any estimator setting chosen by looking at scores is chosen on a dataset with seed A and reported on
a dataset with seed B, and a third dataset generated with a different generator config (different
load-model and geography parameters) is reported as a robustness check. The report states which
dataset each figure comes from. This is what keeps the model from being fitted to the generator.

### 6.7 Sensitivity runs

`--hide-smart F` hides the interval data of a seeded fraction F of smart meters (inverter data
stays). Each hidden customer gets a bill computed from its observed data (import − export +
generation, × 30/7, rounded) and is estimated as unmetered. Runs at several F give error against
smart-meter share. Runs with different NMD sets give error against NMD count.

## 7. NMD placement (`packages/engine/leco/nmdPlacement.js`)

For each rebuilt feeder and k = 0..3 NMDs: an NMD at pole p measures the per-phase flow into p from the
transformer side, i.e. the loads at p and everything beyond it (one row block of H). The posterior covariance in 6.3 depends only on H, Σ
and R, not on readings, so the expected error (trace of the posterior covariance of unmetered loads,
summed over a set of representative intervals) is computed exactly for any candidate set before
anything is installed.

- k ≤ 2: all pole combinations; reported as **Exact optimum**.
- k = 3: greedy, then one-swap improvement; reported as **Best found**.

Outputs per feeder: recommended poles, distance from the transformer, that distance as a fraction
of feeder length, and expected error against k. System-wide: the distribution of optimal positions
as a fraction of feeder length and of downstream load, which is the answer to "how should the NMD
distance be chosen".

Validation (synthetic only): install the recommended set and the naive rules (feeder end, midpoint by
length, random) as separate NMD sets, run the estimator on each, score each, and compare predicted
against actual improvement.

Costs are used only if a cost per NMD is entered (then an error-against-cost curve is added);
otherwise the objective is error alone.

## 8. Server (`server/src/routes/leco.js`)

All routes need `requireAuth`. `LECO_DATA_DIR` locates datasets. Dataset, branch, transformer, run
and NMD set ids are checked against the manifest and directory listings before any path is built;
anything else answers 404.

| Route | Purpose |
|---|---|
| `GET /api/leco/datasets` | Datasets with manifest headline (synthetic flag, households, branches). |
| `GET /api/leco/:ds/runs` | Estimate runs and whether each has a score. |
| `GET /api/leco/:ds/runs/:run/summary` | System and branch figures, transformer list with key figures. |
| `GET /api/leco/:ds/runs/:run/tx/:tx` | One transformer's estimate (JSON plus band arrays). |
| `GET /api/leco/:ds/runs/:run/score` | Score, if present. |
| `GET /api/leco/:ds/truth/tx/:tx` | Truth overlay for display; synthetic datasets only. |
| `POST /api/leco/:ds/nmd-sets` | Install: body is a list of requested positions; snaps each to the nearest real pole on the transformer's real network, writes a new immutable set with readings from `truth/flows`. Refused (409) on datasets without truth. |

Batch estimation and scoring stay command-line (`scripts/leco/*.mjs`); at about 10–50 min for all
of LECO they do not fit an HTTP request.

## 9. Pages (sidebar group "LECO system")

Every page shows a "Synthetic data" banner when the dataset's manifest says synthetic, and a
dataset and run picker.

1. **LECO overview** (`/app/leco`): key figures (households, smart share, transformers, PV MWp,
   peak MW, unexplained energy, estimation error), branch table, Leaflet map of all transformers
   coloured by a chosen metric (canvas renderer for about 2,900 markers). A transformer opens its
   page.
2. **Transformer** (`/app/leco/tx/:id`): rebuilt network on a map (smart and unmetered customers,
   poles, spans, NMDs), feeder list, customer table with estimates and bands, chart of NMD readings
   against the sum of estimates, "Show truth" overlay (synthetic only), **Open as design**.
3. **Estimation** (`/app/leco/estimation`): system and per-branch accuracy, accuracy per stage,
   error against smart-meter share (from runs that used `--hide-smart`), band coverage, error
   distributions.
4. **NMD placement** (`/app/leco/nmd`): per-feeder recommendations, error against k, system-wide
   histogram of position as a fraction of feeder length, recommended against naive rules,
   "Install recommended set" (synthetic only; then run the estimate CLI with that set).

Reuse: `Readout`, Chart.js defaults and palettes, Leaflet patterns from `MapPage.jsx`, `CsvButton`,
the stage 1 page header and sidebar. Strings go through i18n with English text; Sinhala and Tamil
fall back to English.

## 10. Testing and verification

- Generator: `selfcheck.py` (5.6).
- Fixture: `docs/test-data/leco-mini/`, a small dataset (about 3 transformers, both `observed/` and
  `truth/`), generated once and committed so JS tests do not need Python.
- Engine (Vitest): Bayesian update against its closed form on a 3-variable case; placement
  exhaustive search against brute force; topology on hand-made point sets; assignment and phase
  accuracy on the fixture above stated floors; `toDesign` output loads through `withDefaults` and
  converges; the truth-wall test (4.4).
- Server (supertest): each route on the fixture; path-traversal and unknown ids answer 404; install
  answers 409 without truth; install writes a new set and never modifies an existing one.
- Existing suites (goldens, reference lock, lint, typecheck) pass unchanged.
- End-to-end on the full dataset: generate, estimate, score, view pages; the figures go into
  PROGRESS.md with the dataset seeds used.

## 11. Error handling

- Missing or unreadable dataset, run or file: the route answers 404 with a plain message; pages show
  it instead of a blank screen.
- `formatVersion` mismatch: the server refuses the dataset with a message naming both versions.
- A `.bin` whose size disagrees with its sidecar is refused, never partly read.
- Estimator warnings (filled gaps, clipped negatives, ambiguous phases, no feeder NMD) are collected
  in `run.json` and shown on the pages.

## 12. Build order

Each step is usable and tested before the next. Work happens in its own worktree and branch, so the
uncommitted UI stage 1 changes on `ui-redesign-stage1` do not mix with it.

1. Data contract (section 4) and the generator with self-check; the `leco-mini` fixture.
2. Estimator stages 1–3, `toDesign`, scoring, CLIs.
3. NMD placement and the server install route.
4. Server read routes.
5. Pages.
6. Full-scale run, tuning discipline datasets, PROGRESS.md and README sections.

## 13. Risks

- **Topology rebuild accuracy.** Minimum spanning trees ignore streets; without road data, length
  error may be large in irregular areas. The per-feeder length factor and the voltage check bound the
  damage, and the score reports it honestly.
- **Voltage-correlation assignment** may fail between transformers on the same MV feeder with
  similar loading. Confidence is reported; low-confidence assignments are visible on the pages.
- **Synthetic optimism.** The generator cannot contain everything real data will (meter faults,
  clock errors, theft, wrong GIS). The robustness dataset (6.6) helps; real-data results will be
  worse, and the pages say the figures come from synthetic data.
- **Scale.** About 1.5 GB of truth flows and 40M smart-meter readings per dataset. Entity-major
  binary files keep reads per transformer small; nothing loads a whole branch into the browser.
