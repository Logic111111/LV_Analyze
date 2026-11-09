# LECO Plan 1: Data Contract, Synthetic Generator and Fixture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce reproducible synthetic LECO datasets (about 200,000 households, 7 branches, one simulated week) in the `observed/` and `truth/` file format, plus a small committed fixture that later plans test against.

**Architecture:** A dev-only Python tool in `scripts/leco_synth/` builds synthetic geography and LV networks (numpy), generates loads and solar (numpy), solves one OpenDSS circuit per transformer for 336 half-hour steps (`opendssdirect.py`, parallel across cores), simulates measurements, and writes the data contract. A pure engine module `packages/engine/leco/dataset.js` reads the binary format, so JavaScript and Python agree on it from day one.

**Tech Stack:** Python 3.13, numpy 2.2.6, opendssdirect.py 0.9.4, stdlib `unittest`/`multiprocessing`; JavaScript engine module with Vitest.

**Spec:** `docs/superpowers/specs/2026-10-27-leco-synthetic-network-design.md` (sections 4, 5, 10, 12 step 1). Later plans: 2 estimator and scoring, 3 NMD placement and install, 4 server, 5 pages. Each is written once its predecessor has landed.

## Global Constraints

- Python dependencies are exactly `numpy==2.2.6` and `opendssdirect.py==0.9.4` in `scripts/leco_synth/requirements.txt`. Tests use stdlib `unittest`. No pandas, scipy or pytest.
- Dev tool only: nothing in `client/` or `server/` imports or runs Python.
- Binary series: little-endian float32, entity-major `[entity][step][channel]`, sidecar `<base>.json` = `{ "ids": [...], "steps": 336, "channels": [...] }`, NaN = missing or invalid.
- `FORMAT_VERSION = 1`; `steps = 336`; `intervalMin = 30`.
- No JSON under `observed/` contains the keys `txId`, `poleId` or `phase`. Customer ids are `<BRANCH>-C<6 digits>`, numbered in a shuffled order. They never contain a transformer id.
- Units: P kW, Q kvar, I A, V volts phase-to-neutral, energy kWh.
- Flow channels, everywhere they appear: `["p_a","p_b","p_c","q_a","q_b","q_c","i_a","i_b","i_c","v_a","v_b","v_c"]`.
- Electrical constants are copied from the engine, not invented:
  - LV 415 V line-to-line (`secondaryLNVoltage`), HV 11 kV;
  - taps `{1: 11275, 2: 11000, 3: 10725, 4: 10450}` V (`TAPS`);
  - transformer ratings 100/160/250/630 kVA with z = 0.04 (`TRANSFORMERS`) and X/R 3 (`defaultDesign`);
  - neutral earth 7.5 Ω;
  - conductors `70ABC` {R 0.443, Z 0.453, neutralScale 70/50} and `50ABC` {R 0.641, Z 0.647, neutralScale 50/35} Ω/km, with X = √(Z² − R²), Rn = R × neutralScale, Xn = X.
- Every other number in a config file has a `_notes` entry saying "assumption" or citing a source URL.
- Determinism: the same config and seed give byte-identical `.bin` files and data JSON whatever `--jobs` is.
- `packages/engine/leco/*.js`: `// @ts-check`, JSDoc types, no imports from outside `packages/engine`, no Node or DOM APIs.
- Existing `npm test`, `npm run lint`, `npm run typecheck` (in `client/`) stay green, and golden values stay unchanged.
- Commit messages are prefixed `L1.<task>:` with **no Co-Authored-By trailer** (user's standing rule).
- Python tests run with `python -m unittest discover -s scripts/leco_synth -p "test_*.py" -v` from the repo root.

## Review Focus

1. **Topology leaking through ids or file order in `observed/`.** A customer id or the order of `customers.json` must not reveal the transformer. Task 6 tests the id format and the consecutive-same-transformer fraction.
2. **Physically invalid OpenDSS steps.** A step that fails to converge, or converges below 0.5 pu, must become NaN plus a count in the manifest, and must never pass as a value. More than 0.1% invalid transformer-steps exits with code 2. Task 4 tests the NaN rule; Task 6 tests the manifest count.
3. **Re-running into an existing output folder.** Without `--force` the run refuses and touches nothing. `--force` removes only `observed/` and `truth/`. Tested in Task 6.
4. **Parallel runs giving different data.** `--jobs 1` and `--jobs 2` must give identical bytes, including under Windows' spawn start method. Tested in Task 6.
5. **Irregular geography.** Even with heavy street removal, every customer must be within 35 m of a pole on its own transformer's tree, every tree must be connected and acyclic, and no area may exceed a 630 kVA rating. Task 2 tests this across seeds, including `streetRemoval: 0.3`.

---

### Task 0: Worktree and design documents

- [ ] **Step 1:** Create the worktree with superpowers:using-git-worktrees, on branch `leco-synthetic-network` from `ui-redesign-stage1` HEAD (`bfb429e`). The uncommitted UI stage 1 changes stay in the main working tree.
- [ ] **Step 2:** Copy `docs/superpowers/specs/2026-10-27-leco-synthetic-network-design.md` and this plan from the main working tree into the worktree, then commit:

```bash
git add docs/superpowers/specs/2026-10-27-leco-synthetic-network-design.md docs/superpowers/plans/2026-10-27-leco-plan1-generator.md
git commit -m "L1.0: LECO design spec and plan 1"
```

### Task 1: Data contract (Python writer and reader, JS reader)

**Files:**
- Create: `scripts/leco_synth/requirements.txt`, `scripts/leco_synth/contract.py`, `scripts/leco_synth/test_contract.py`
- Create: `packages/engine/leco/dataset.js`, `client/src/lib/__tests__/leco.dataset.test.js`
- Modify: `packages/engine/index.js` (module map line `leco/dataset.js  LECO dataset binary series reader`, plus `export * from './leco/dataset.js';`), `.gitignore` (add `/data/`)

**Interfaces:**
- Produces (Python, `contract.py`):
  - `FORMAT_VERSION = 1`
  - `FORBIDDEN_OBSERVED_KEYS = ("txId", "poleId", "phase")`
  - `write_json(path: str, obj) -> None`: creates parent directories, UTF-8, compact separators `(",", ":")`.
  - `create_series(base: str, ids: list[str], steps: int, channels: list[str]) -> np.memmap`: writes the sidecar `base + ".json"` and returns a writable `'<f4'` memmap of shape `(len(ids), steps, len(channels))` at `base + ".bin"`, filled with NaN.
  - `read_series(base: str) -> tuple[dict, np.ndarray]`: raises `ValueError` naming the expected and actual byte counts on a size mismatch.
  - `find_forbidden_keys(obj) -> list[str]`: paths of offending keys, recursive, e.g. `"a[0].txId"`.
- Produces (JS, `dataset.js`):
  - `export const LECO_FORMAT_VERSION = 1`
  - `export function openSeries(buffer: ArrayBuffer, sidecar: { ids: string[], steps: number, channels: string[] })` returns `{ ids, steps, channels, has(id): boolean, get(id): Float32Array, channel(id, name): Float32Array }`:
    - `get` is a no-copy view of length `steps × channels`;
    - `channel` is a strided copy of length `steps`;
    - it throws `Error` with the message `expected <n> bytes, got <m>` on a size mismatch, and throws on an unknown id or channel.

- [ ] **Step 1: Write failing tests.**
  - Python `test_contract.py`:
    - `test_round_trip`: 2 ids × 3 steps × 2 channels, including one NaN, are read back equal with `np.testing.assert_array_equal`, NaN in place.
    - `test_size_mismatch_raises`: truncate the `.bin` by 4 bytes, then `read_series` raises `ValueError`.
    - `test_forbidden_keys`: `find_forbidden_keys({"a": [{"txId": 1}], "b": {"phase": "A"}})` returns `["a[0].txId", "b.phase"]`.
  - JS `leco.dataset.test.js`:
    - Build `Float32Array([0,1, 2,3, 4,5, 10,11, 12,13, 14,15])` with sidecar `{ ids: ['a','b'], steps: 3, channels: ['x','y'] }`.
    - Assert `get('b')` equals `[10,11,12,13,14,15]`, `channel('b','y')` equals `[11,13,15]`, and `has('c')` is false.
    - Assert a 44-byte buffer throws `/expected 48 bytes, got 44/`, and `get('c')` throws.
- [ ] **Step 2: Run both and see them fail.** Python: `python -m unittest scripts/leco_synth/test_contract.py -v` fails with `ModuleNotFoundError: contract`. JS: `cd client && npx vitest run src/lib/__tests__/leco.dataset.test.js` fails on the import.
- [ ] **Step 3: Implement `contract.py`, `dataset.js`, the index export, `requirements.txt` and `.gitignore`.** `dataset.js` uses a `Float32Array` view over the buffer, with the comment `// shortcut: Float32Array uses host byte order; every supported platform is little-endian. Use DataView if a big-endian host ever matters.`
- [ ] **Step 4: Run the Python tests, the JS test, then `cd client && npm test && npm run lint && npm run typecheck`.** Expected: all PASS.
- [ ] **Step 5: Commit** `L1.1: LECO data contract, Python writer and engine reader`.

### Task 2: Configuration and synthetic geography

**Files:**
- Create: `scripts/leco_synth/config.json`, `scripts/leco_synth/geo.py`, `scripts/leco_synth/test_geo.py`

**Interfaces:**
- Produces (`geo.py`):
  - `to_latlon(x_m: float, y_m: float, lat0: float, lon0: float) -> tuple[float, float]`: equirectangular, 111,320 m per degree of latitude, longitude scaled by `cos(lat0)`.
  - `split_households(total: int, weights: list[float]) -> list[int]`: largest remainder, ties go to the earlier branch.
  - `build_branch(branch: dict, n_households: int, cfg: dict, rng: np.random.Generator) -> dict` returning:

```text
{ "neighbourhoods": [{ "id", "x", "y" }],
  "mvFeeders": [{ "id", "txIds": [...] }],
  "transformers": [{ "id": "<BR>-T0001", "x", "y", "lat", "lon", "ratingKva", "tap", "mvFeeder", "mvRank": 0..1,
      "poles":     [{ "id": "<txId>-P001", "x", "y", "lat", "lon", "parent": "<poleId or txId>", "earthed": bool }],
      "spans":     [{ "id": "<downstream poleId>", "from": "<poleId or txId>", "to": "<poleId>", "lengthM", "conductor" }],
      "customers": [{ "key": int, "x", "y", "lat", "lon", "poleId", "phase": "A"|"B"|"C" }] }] }
```

  `key` is unique within the branch. Customer ids are assigned later, in Task 6.

- [ ] **Step 1: Write `config.json`.** Top-level keys:
  - `seed: 20261027`, `startDate: "2026-03-02"` (a Monday), `steps: 336`, `intervalMin: 30`, `households: 200000`;
  - `branches`: 7 entries `{id, name, lat, lon, weight: 1}` with ids `KOT NUG MOR KAL KEL NEG GAL`;
  - `neighbourhood {householdsMin: 2000, householdsMax: 5000, radiusKm: 8, minSeparationKm: 1.5, blockM: [80,150], streetRemoval: 0.15, houseSpacingM: [10,25], setbackM: 10}`;
  - `smartShare: 0.6`, `pvShareAmongSmart: 1.0`, `commercialShare: 0.05`;
  - `transformer {customersPerTx: [40,120], ratingsKva: [100,160,250,630], kvaPerCustomer: 1.5, zPct: 4, xr: 3, tapWeights: {"1":0.1,"2":0.7,"3":0.2,"4":0}, neutralEarthOhm: 7.5, lvKv: 0.415, hvKv: 11}`;
  - `lv {poleSpacingM: [30,40], maxServiceDropM: 35, trunkMinCustomers: 20, trunkConductor: "70ABC", branchConductor: "50ABC", endPoleEarthOhm: 30, phaseImbalance: [0.40,0.33,0.27]}`;
  - `conductors` (the engine values in Global Constraints);
  - `mv {txPerFeeder: [20,40], ar1Sigma: 0.002, ar1Phi: 0.9, maxDropPu: 0.02}`;
  - `domestic`, `commercial`, `solar` and `measure` are added in Tasks 3 and 5.

  Branch `lat`/`lon` come from each town's English Wikipedia infobox, to 4 decimals, with the page URL in `_notes`. `_notes` labels every other value "assumption" (the electrical ones "copied from packages/engine/model.js").
- [ ] **Step 2: Write failing tests** in `test_geo.py`, using a small config: `households 600`, one branch, `householdsMin/Max 600`.
  - `test_split_households`: `split_households(200000, [1]*7) == [28572, 28572, 28572, 28571, 28571, 28571, 28571]`.
  - `test_to_latlon`: `to_latlon(0, 111320, 7, 80) == (8.0, 80.0)`, and `to_latlon(111320*cos(radians(7)), 0, 7, 80)` gives lon 81.0 (to 1e-9).
  - `test_service_drop_and_trees` for seeds 1..5 and for `streetRemoval` 0.15 and 0.3:
    - each customer's distance to its own pole is ≤ 35.0 m;
    - per transformer, `len(spans) == len(poles)`;
    - following `parent` from every pole reaches the transformer id within `len(poles)` steps;
    - every `poleId` belongs to the customer's own transformer.
  - `test_counts_and_ratings`:
    - the total number of customers equals 600;
    - every transformer has at least 1 customer;
    - `ratingKva` is in the ratings list and ≥ customers × 1.5.
  - `test_areas_touch`: the fraction of customers whose nearest transformer (straight-line) is not their own is > 0.02.
  - `test_phase_mix`: each phase's share over all customers is in [0.2, 0.5].
  - `test_deterministic`: two builds with seed 7 give equal `json.dumps` output.
- [ ] **Step 3: Run them and see them fail** (`ModuleNotFoundError: geo`).
- [ ] **Step 4: Implement `geo.py`.** Approach, where the signature leaves a choice:
  1. **Neighbourhood sizes:** draw from U[min, max] until the target is met, and truncate the last one. Place centres within `radiusKm` by rejection on `minSeparationKm`; after 1,000 failed tries, relax the separation by 10%.
  2. **Street grid:** perturbed grid with block sizes U(`blockM`), rotated U(0°, 90°). Remove `streetRemoval` of the edges, but only edges whose removal keeps the grid connected.
  3. **Houses:** on both sides of each street at `setbackM`, spaced U(`houseSpacingM`), until the neighbourhood's count is placed.
  4. **Transformers:** T = ceil(houses / mean(`customersPerTx`)). Run 10 iterations of numpy k-means on house positions and snap each centre to a distinct street node. Assign each house by multi-source Dijkstra (`heapq`) distance along streets. If any area's customers × `kvaPerCustomer` > 630, repeat with T + 1.
  5. **LV tree:** the union of shortest paths from the transformer node to each house's nearest street node. Split each tree edge into ceil(length / U(`poleSpacingM`)) spans. Each house joins the nearest pole of its own tree; if that is over `maxServiceDropM`, insert a pole at the house's projection onto the nearest tree edge.
  6. **Equipment:** spans with ≥ `trunkMinCustomers` downstream get `trunkConductor`, the rest `branchConductor`. Leaf poles are `earthed: true`. Phase probabilities are a random permutation of `phaseImbalance` per transformer. The tap comes from `tapWeights`. The rating is the smallest one with ≥ customers × `kvaPerCustomer`.
  7. **MV feeders:** within a neighbourhood, sort transformers by angle around its centre and cut them into runs of U(`txPerFeeder`) (a single run if there are fewer). `mvRank = index / (len − 1)`, or 0 for a single transformer.
- [ ] **Step 5: Run `test_geo.py`.** Expected: PASS.
- [ ] **Step 6: Commit** `L1.2: LECO generator config and synthetic geography`.

### Task 3: Loads and solar

**Files:**
- Create: `scripts/leco_synth/loads.py`, `scripts/leco_synth/test_loads.py`
- Modify: `scripts/leco_synth/config.json` (add `domestic`, `commercial`, `solar`)

**Interfaces:**
- Consumes: `cfg` from Task 2.
- Produces (`loads.py`):
  - `customer_attributes(n: int, cfg: dict, rng) -> list[dict]`: each dict is `{tariff: "domestic"|"commercial", smart: bool, pvKwp: float|None, monthlyKwh: float}`. A customer has PV only if it is smart; `pvKwp` is lognormal, clipped to [`kwpMin`, `kwpMax`] and rounded to 0.1.
  - `demand_profiles(attrs: list[dict], cfg: dict, start_date: str, steps: int, rng) -> tuple[np.ndarray, np.ndarray]`: `(kw, kvar)`, each of shape `(n, steps)`.
  - `clear_sky_per_kwp(lat: float, lon: float, start_date: str, steps: int, cfg: dict) -> np.ndarray`: shape `(steps,)`.
  - `branch_cloud(days: int, cfg: dict, rng) -> np.ndarray`: shape `(days,)`, Beta(`cloudBeta`).
  - `pv_profiles(pv_kwp: np.ndarray, clear: np.ndarray, cloud: np.ndarray, cfg: dict, rng) -> np.ndarray`: shape `(n, steps)`.

- [ ] **Step 1: Add the config blocks** (all labelled "assumption" in `_notes`):
  - `domestic {monthlyKwhMedian: 90, monthlyKwhSigma: 0.6, appliances: [...]}`. Each appliance is `{name, own, kw, pf, mode: "continuous"|"window"|"events", windows: [[startH, endH], ...], usesPerDay, durationSteps, weekendFactor}`, covering lighting, refrigerator, fans, TV, cooking, water pump, iron, AC (`own` 0.1, night window) and washing machine.
  - `commercial {monthlyKwhMedian: 400, monthlyKwhSigma: 0.8, openHour: 8, closeHour: 20, baseFraction: 0.15}`.
  - `solar {kwpMedian: 5, kwpSigma: 0.4, kwpMin: 1, kwpMax: 20, derate: 0.8, cloudBeta: [5, 2], variabilitySigma: 0.1, variabilityPhi: 0.7, utcOffsetH: 5.5}`.

  Search the PUCSL or CEB statistical digests for the average Sri Lankan domestic kWh per month. If one is found, set `monthlyKwhMedian` from it and cite the URL; otherwise keep 90 and label it "assumption, no source found".
- [ ] **Step 2: Write failing tests** in `test_loads.py`:
  - `test_week_energy_exact`: 50 domestic and 10 commercial customers; `kw.sum(axis=1) * 0.5` equals `monthlyKwh * 7 / 30` to relative 1e-9.
  - `test_evening_peak`: the argmax of the mean domestic weekday profile falls in the half-hours from 18:00 to before 22:30.
  - `test_commercial_daytime`: the commercial mean over 10:00–16:00 is > 2 × its mean over 00:00–05:00.
  - `test_solar_shape`, for lat 6.9, lon 79.9:
    - `clear_sky_per_kwp` is 0 for every step from 20:00 to 05:00 local time;
    - its maximum is ≤ `derate`;
    - the daily argmax falls within 11:30–13:00.
  - `test_attributes`: n = 10,000; smart share within 0.6 ± 0.03; no PV on non-smart customers; commercial share within 0.05 ± 0.01.
  - `test_deterministic`: the same seed gives equal arrays.
- [ ] **Step 3: Run them and see them fail.**
- [ ] **Step 4: Implement `loads.py`.**
  - **Appliances:**
    - `continuous` gives a constant kW;
    - `window` gives an on-fraction U(0.5, 1) per day per household inside the windows;
    - `events` draws Poisson(`usesPerDay` × `weekendFactor` on weekends) start steps uniformly inside the windows, each lasting `durationSteps`.
  - kvar = kw × tan(acos(pf)). Each household's week is scaled to `monthlyKwh × 7/30`.
  - Commercial: `baseFraction` outside opening hours, 1 ± U(0.1) inside, then scaled the same way.
  - **Solar position**, at interval midpoints in local time:
    - day of year d;
    - declination δ = 23.45° sin(360°(284 + d)/365);
    - B = 360°(d − 81)/364, and EoT (min) = 9.87 sin 2B − 7.53 cos B − 1.5 sin B;
    - solar time = clock + (4(lon − 15 × utcOffsetH) + EoT)/60 h;
    - ω = 15°(solar time − 12);
    - cos z = sin φ sin δ + cos φ cos δ cos ω.
  - **Haurwitz clear sky:** GHI = 1098 cos z · exp(−0.057 / cos z) for cos z > 0, else 0. Per-kWp output = derate × GHI / 1000.
  - **PV:** kWp × clear × cloud[day] × a per-customer AR(1) factor (`variabilityPhi`, `variabilitySigma`) clipped to [0, 1].
- [ ] **Step 5: Run `test_loads.py`.** Expected: PASS.
- [ ] **Step 6: Commit** `L1.3: LECO household, commercial and solar profiles`.

### Task 4: OpenDSS simulation of one transformer

**Files:**
- Create: `scripts/leco_synth/simulate.py`, `scripts/leco_synth/test_simulate.py`

**Interfaces:**
- Consumes: a transformer dict in the `build_branch` shape (Task 2) and `cfg`.
- Produces (`simulate.py`):
  - `CHANNELS = ["p_a","p_b","p_c","q_a","q_b","q_c","i_a","i_b","i_c","v_a","v_b","v_c"]`
  - `build_script(tx: dict, cfg: dict) -> tuple[str, dict]`: the DSS script, plus name maps `{"load": [...], "pv": [...], "line": [...], "custNode": [(bus, node), ...]}` in customer and span order.
  - `simulate_tx(tx: dict, kw: np.ndarray, kvar: np.ndarray, pv_kw: np.ndarray, mv_pu: np.ndarray, cfg: dict) -> dict`, with arrays in `tx["customers"]` and `tx["spans"]` order:
    - `v (n, steps)`: customer phase-to-neutral V;
    - `flows (spans, steps, 12)`;
    - `board (steps, 12)`;
    - `lossKw (steps,)`;
    - `valid (steps,) bool`.

- [ ] **Step 1: Install and verify the API.**
  1. Run `pip install -r scripts/leco_synth/requirements.txt`.
  2. Run `python -c "import opendssdirect as dss; print(all([hasattr(dss.Vsources,'PU'), hasattr(dss.Loads,'kW'), hasattr(dss.Loads,'kvar'), hasattr(dss.Circuit,'AllBusVolts'), hasattr(dss.Circuit,'AllNodeNames'), hasattr(dss.Circuit,'SetActiveElement'), hasattr(dss.CktElement,'Powers'), hasattr(dss.CktElement,'CurrentsMagAng'), hasattr(dss.CktElement,'Losses'), hasattr(dss.Circuit,'Losses')]))"`. Expected: `True`.
  3. If it prints `False`, find the equivalent call with `help()` on the installed package and use it. Do not guess.
- [ ] **Step 2: Write failing tests** in `test_simulate.py`. A `make_tx(...)` helper builds small transformers by hand.
  - `test_no_load_voltage`: 1 pole, 1 customer, zero load, `mv_pu = 1`, tap 2. Customer V = 415/√3 ± 0.05 V.
  - `test_tap`: tap 3. V = 415/√3 × 11000/10725 ± 0.05 V.
  - `test_energy_balance`: a 3-pole chain, 6 customers (2 with PV), random loads over 336 steps. At every valid step, `board[:, 0:3].sum()` equals `(kw − pv_kw)[:, t].sum() + lossKw[t]` within 1e-3 kW.
  - `test_drop_direction`: the far customer on phase A has a lower V than the near customer on phase A under load.
  - `test_phase_mapping`: a 2 kW load on the phase-B customer only gives board `p_b` = 2 ± 0.1, and |`p_a`|, |`p_c`| < 0.01.
  - `test_invalid_step_is_nan`: 5,000 kW on one customer at the end of 2 km of `50ABC` at step 5 only. `valid[5]` is False, `v[:, 5]` and `board[5]` are all NaN, and every other step is valid.
- [ ] **Step 3: Run them and see them fail.**
- [ ] **Step 4: Implement `simulate.py`, mirroring `packages/engine/opendss.js`:**
  - **Source:** `New Circuit` at bus `hv` with `basekv=hvKv pu=<mv> angle=-30 phases=3 Z1=[1e-6 1e-6] Z0=[1e-6 1e-6]`.
  - **Transformer:** delta–wye, `kVs=[TAPS[tap]/1000 lvKv]`, `%Rs=[%R/2 %R/2]` with %R = zPct/√(1 + xr²), `XHL = %R × xr`, `%noloadloss=0 %imag=0 LeadLag=Lead`.
  - **Earthing:** a `Reactor` from the LV star point to ground, R = `neutralEarthOhm`. Earthed poles get one with R = `endPoleEarthOhm`.
  - **Lines:** a 4×4 diagonal `LineCode` per conductor (`Kron=No`, zero `cmatrix`) and 4-wire `Line`s.
  - **Loads:** one single-phase `Load` per customer, `bus1=<pole>.<1|2|3>.4 kV=lvKv/√3 model=1 vminpu=0.1 vmaxpu=2 vlowpu=0.05`. Each PV customer also gets a second `Load` carrying negative kW.
  - **Solution:** `Set mode=snapshot maxiterations=200 tolerance=1e-8`.
  - **Each step:**
    1. Set the source PU and every load's kW and kvar, then solve.
    2. `valid = Converged() and min(customer V) >= 0.5 × 415/√3`.
    3. Board readings are the negated transformer terminal-2 powers, plus currents and LV-bus V.
    4. Flows are each line's terminal-1 per-phase powers, plus current magnitudes and the downstream pole's V.
    5. `lossKw = (Circuit.Losses()[0] − transformer element Losses()[0]) / 1000`.
    6. If the step is invalid, set every output for it to NaN.
- [ ] **Step 5: Run `test_simulate.py`.** Expected: PASS.
- [ ] **Step 6: Commit** `L1.4: LECO OpenDSS simulation per transformer`.

### Task 5: Measurement simulation

**Files:**
- Create: `scripts/leco_synth/measure.py`, `scripts/leco_synth/test_measure.py`
- Modify: `scripts/leco_synth/config.json` (add `measure {meterKwhNoise: 0.005, meterKwhRound: 0.01, meterVSigma: 0.25, meterVRound: 0.1, missingFraction: 0.01, meanBurstSteps: 4, nmdSigma: 0.0025, monthFactorSigma: 0.1}`, each labelled "assumption")

**Interfaces:**
- Consumes: `CHANNELS` from Task 4.
- Produces (`measure.py`):
  - `METER_CHANNELS = ["kwh_in", "kwh_out", "v"]`, `INVERTER_CHANNELS = ["kwh_gen"]`
  - `gap_mask(n: int, steps: int, cfg: dict, rng) -> np.ndarray`: bool `(n, steps)`, True means missing. Bursts per meter ~ Poisson(`missingFraction × steps / meanBurstSteps`); lengths are geometric with mean `meanBurstSteps`.
  - `meter_series(net_kw: np.ndarray, v: np.ndarray, cfg: dict, rng) -> np.ndarray`: `(n, steps, 3)`. kWh = max(±net, 0) × 0.5 × (1 + N(0, `meterKwhNoise`)), rounded to `meterKwhRound`; V + N(0, `meterVSigma`) rounded to `meterVRound`; gaps are NaN on all channels.
  - `inverter_series(pv_kw: np.ndarray, cfg: dict, rng) -> np.ndarray`: `(n, steps, 1)`, the same noise, rounding and independent gaps.
  - `monthly_bills(gross_kw: np.ndarray, cfg: dict, rng) -> np.ndarray`: int64 `(n,)` = round(Σ gross × 0.5 × 30/7 × LogNormal(0, `monthFactorSigma`)).
  - `nmd_series(board: np.ndarray, cfg: dict, rng) -> np.ndarray`: `(m, steps, 12)`; each value × (1 + N(0, `nmdSigma`)); NaN passes through.

- [ ] **Step 1: Write failing tests:**
  - `test_gap_statistics`: over 2,000 meters, the missing fraction is in [0.008, 0.012] and the mean burst length is in [3, 5].
  - `test_meter_exact_without_noise`: with `meterKwhNoise = meterVSigma = 0`, `kwh_in − kwh_out == round(net × 0.5, 2)` and `v == round(v, 1)` on non-gap steps; gap steps are NaN on all 3 channels.
  - `test_meter_noise_level`: net = 1 kW everywhere; the standard deviation of `kwh_in / 0.5 − 1` is in [0.004, 0.006].
  - `test_bills`: results are non-negative integers; with `monthFactorSigma = 0` they equal `round(Σ gross × 0.5 × 30/7)`.
  - `test_nmd_channel_order`: input with `p_b = 10` and all else 0 gives output `p_b` within 1% of 10, and every other channel exactly 0.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement `measure.py`.**
- [ ] **Step 4: Run `test_measure.py`.** Expected: PASS.
- [ ] **Step 5: Commit** `L1.5: LECO measurement simulation`.

### Task 6: Generator CLI, self-check, fixture and cross-language contract test

**Files:**
- Create: `scripts/leco_synth/generate.py`, `scripts/leco_synth/selfcheck.py`, `scripts/leco_synth/config.mini.json`, `scripts/leco_synth/test_generate.py`, `docs/test-data/leco-mini/**` (generated)
- Modify: `client/src/lib/__tests__/leco.dataset.test.js`, `docs/test-data/README.md` (a row for `leco-mini/`)

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces:
  - `generate.py`:
    - `generate(cfg: dict, out: str, jobs: int) -> dict` returns the manifest.
    - CLI `--config PATH --out DIR [--jobs N] [--seed N] [--force]`. `--seed` overrides `cfg["seed"]`, and the overridden value is recorded in the manifest and in `truth/generator-config.json`.
    - Exit codes:
      - 0: success;
      - 1: refused, because DIR is non-empty and `--force` wasn't given;
      - 2: invalid transformer-steps above 0.1% (data and manifest are still written).
  - `selfcheck.py`: `selfcheck(out: str) -> list[str]` (the failures) and a CLI `selfcheck.py DIR` that exits 0 or 1.
  - Files exactly as spec section 4. `datasetId` = basename of DIR. NMD set `tx-only`: `nmdId = "<txId>-N0"`, `kind: "transformer"`, `createdBy: "generator"`, `requested` = `installed` = the transformer's lat/lon.
  - Id order:
    - `customers.json`, meter, inverter and truth customer series: by customer id;
    - flows: spans in transformer order;
    - board and losses: transformer ids.

- [ ] **Step 1: Write `config.mini.json`:** a copy of `config.json` with `households 150`, branches `[KOT]` only, `householdsMin/Max 150`, `customersPerTx [40,60]` and `mv.txPerFeeder [2,4]`. `_notes` says "fixture config".
- [ ] **Step 2: Write failing tests** in `test_generate.py`, with a micro config (60 households, 1 branch, `customersPerTx [25,35]`) in a temp dir:
  - `test_deterministic_across_jobs`: `--jobs 1` and `--jobs 2` give equal SHA-256 for every `.bin`, `customers.json`, `transformers.json` and `truth/network/*.json`.
  - `test_refuses_existing`: a second run without `--force` exits 1, and every existing file's mtime is unchanged.
  - `test_force_scope`: write `<out>/keep.txt`, run with `--force`; `keep.txt` still exists.
  - `test_ids_do_not_leak`: every customer id matches `^[A-Z]{3}-C\d{6}$` and contains no transformer id.
  - `test_selfcheck_clean`: `selfcheck(out) == []`, and `manifest["warnings"]["invalidSteps"] == 0`.
- [ ] **Step 3: Run them and see them fail.**
- [ ] **Step 4: Implement `generate.py`:**
  - **Seeds:** `np.random.SeedSequence(seed)` spawns one child per branch. Each branch child spawns `[layout, attrs, ids, cloud, mv, measure, tx]`, and `tx` spawns one child per transformer in transformer order. This makes the output independent of `--jobs`.
  - **Per branch, in the main process:**
    1. `build_branch`, then `customer_attributes`.
    2. Shuffle the customers and assign ids `<BR>-C%06d` in shuffled order.
    3. Run `demand_profiles` and `pv_profiles` for the whole branch.
    4. MV voltage: `mv_pu[t] = 1 + ar1_feeder[t] − maxDropPu × mvRank × L(t)`, where L = branch Σkw / max Σkw.
  - **Per transformer, in workers:** `run_tx(job: dict) -> dict` is a top-level, picklable function that calls `simulate_tx`.
  - **Pool:** with `--jobs > 1`, use `multiprocessing.get_context("spawn").Pool(jobs)` with `imap(run_tx, jobs, chunksize=4)`. `--jobs 1` runs in-process. Keep the `if __name__ == "__main__":` guard.
  - **Writing:** results go into `create_series` memmaps. After each branch, write the measurements, then write the manifest last.
  - **`--force`:** delete only `<out>/observed` and `<out>/truth`.
- [ ] **Step 5: Implement `selfcheck.py`.** Failures, each as one line:
  - forbidden keys anywhere in `observed/*.json`;
  - any `.bin` whose size disagrees with its sidecar;
  - customer id sets that differ between `customers.json`, the truth series and the truth network;
  - meter ids ≠ smart customers, or inverter ids ≠ customers with `pvKwp`;
  - at a valid step, |Σ board p − Σ (kw_gross − pv_kw) − loss_kw| > 1e-3 × max(1, |Σ board p|);
  - a valid-step customer V outside [0.8, 1.15] × 415/√3;
  - a bill that isn't a non-negative integer, or a smart customer with a bill.
- [ ] **Step 6: Run `test_generate.py`.** Expected: PASS.
- [ ] **Step 7: Generate the fixture.**
  1. Run `python scripts/leco_synth/generate.py --config scripts/leco_synth/config.mini.json --out docs/test-data/leco-mini --jobs 1`.
  2. Run `python scripts/leco_synth/selfcheck.py docs/test-data/leco-mini`. Expected: exit 0.
  3. Check the total size is < 5 MB. If not, lower `households` in `config.mini.json` (keeping ≥ 2 transformers) and regenerate.
- [ ] **Step 8: Add fixture tests** to `leco.dataset.test.js`. Read the files with `node:fs` from `new URL('../../../../docs/test-data/leco-mini/', import.meta.url)`.
  - `manifest.formatVersion === LECO_FORMAT_VERSION`, `synthetic === true`, `steps === 336`.
  - No `txId`, `poleId` or `phase` key anywhere in `observed/*.json`.
  - Meter ids equal the smart customer ids; inverter ids equal the ids of customers with `pvKwp`.
  - Every unmetered customer has an integer `billedKwhMonth ≥ 0`; no smart customer has one.
  - **Channel order across languages:** for the first 5 smart meters at non-NaN steps, |(kwh_in − kwh_out) − (kw_gross − pv_kw) × 0.5| ≤ 0.01 × |(kw_gross − pv_kw) × 0.5| + 0.011, using `truth/loads`.
  - **Order leak:** the fraction of consecutive `customers.json` entries that share a truth transformer is < 0.6.
- [ ] **Step 9: Run** `python -m unittest discover -s scripts/leco_synth -p "test_*.py" -v` and `cd client && npm test && npm run lint && npm run typecheck`. Expected: all PASS.
- [ ] **Step 10: Commit** `L1.6: LECO generator CLI, self-check and leco-mini fixture` (include `docs/test-data/leco-mini/`).

### Task 7: Full-scale datasets, timing and documentation

**Files:**
- Create: `scripts/leco_synth/config.robust.json`
- Modify: `PROGRESS.md` (new section "LECO programme", items L1.0–L1.7), `README.md` (subsection "LECO synthetic dataset (dev tool)" under "Tests, benchmarks and CI")

- [ ] **Step 1: Write `config.robust.json`:** a copy of `config.json` with these changes, each noted in `_notes` as "robustness variant":
  - `seed 20261029`;
  - `domestic.monthlyKwhMedian` × 1.3;
  - AC `own` 0.3;
  - `neighbourhood.blockM [60,200]`, `streetRemoval 0.3`;
  - `lv.phaseImbalance [0.5,0.3,0.2]`;
  - `solar.cloudBeta [2,2]`;
  - `transformer.customersPerTx [30,150]`.
- [ ] **Step 2: Generate dataset A**, timing it: `python scripts/leco_synth/generate.py --config scripts/leco_synth/config.json --out data/leco/leco-a --jobs 8`, then `python scripts/leco_synth/selfcheck.py data/leco/leco-a`. Expected: exit 0 from both, in under 3 h. If it takes longer, stop and report the per-transformer time instead of continuing.
- [ ] **Step 3: Generate dataset B** with `--seed 20261028 --out data/leco/leco-b`, and dataset C with `--config scripts/leco_synth/config.robust.json --out data/leco/leco-c`. Self-check each. Expected: exit 0.
- [ ] **Step 4: Update `PROGRESS.md`** for each dataset:
  - seed, households, transformers, spans, invalid steps;
  - wall time with `--jobs 8`, and disk size of `observed/` and `truth/`.

  Update the README subsection: install, generate, self-check, what `observed/` and `truth/` mean, and that every dataset is synthetic.
- [ ] **Step 5: Commit** `L1.7: LECO full-scale datasets A, B, C; docs` (docs only; `data/` is gitignored).
