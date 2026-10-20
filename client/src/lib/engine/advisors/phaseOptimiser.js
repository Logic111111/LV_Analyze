// @ts-check
// Phase balancing v2 (P4.1) — the "Optimised" method beside the legacy greedy "Quick (nameplate)"
// proposal (phaseBalance.js, unchanged).
//
// Objectives (lower is better):
//   'nameplate'  max − min of per-phase connected kVA (the legacy objective);
//   'impedance'  max − min of per-phase Σ kVA·|Z_path|, where Z_path = Σ (Zph + Zn) over the spans
//                from the transformer to the connection's pole. A kVA far down the feeder causes
//                more voltage drop and neutral shift than the same kVA at the first pole, so it
//                counts for more;
//   'loadflow'   Σ over the scanned hours of
//                  violationW × (voltage violations) + neutral I²R (W) + vufWPerPct × Σ_poles (VUF − limit)⁺,
//                evaluated with full load flows of the transformer's own network.
//
// Search: steepest-descent local search from today's arrangement over single moves (a connection
// to another phase) and pair swaps, under a move budget K. It is run for K = 1…Kmax in turn, each
// starting from the best arrangement found with ≤ K moves so far. The best arrangement with
// ≤ K moves for every K is the "moves vs benefit" Pareto table. It is never worse at K than at
// K − 1, by construction: an arrangement with ≤ K − 1 moves also has ≤ K. Optional simulated-
// annealing restarts (seeded mulberry32, so results repeat exactly) feed more starting points
// into the same pool first. The legacy proposal is also put in the pool when it fits the
// budget, so Optimised is never worse than Quick at that move count.
//
// "Moves" counts physical rewiring. Connections that are identical apart from their id and phase
// (e.g. five equal ADMD loads on one pole) are interchangeable. Swapping two of them changes
// nothing, and the move count is the minimum number of drops to re-terminate to reach the
// arrangement (see normaliser below).
import { C, PHASES } from '../complex.js';
import { poleById, isTransformerId, conductorParams, transformerSubDesign } from '../model.js';
import { runHours, summarizeScan, DAILY_HOURS } from '../scan.js';
import { mulberry32, randomInt } from '../random.js';
import { balanceableConnections, proposePhaseBalance, applyPhaseBalance } from './phaseBalance.js';
/** @import { Design, Phase, PhaseMap, SnapshotResult, ProgressHooks } from '../types.js' */
/** @typedef {import('./phaseBalance.js').BalanceItem & { weight: number }} OptimiserItem */
/** @typedef {{ violations: number, neutralLossW: number, vufExcessPct: number }} LoadflowParts */
/** @typedef {{ arr: Phase[], key: string, value: number, d: number, parts?: LoadflowParts }} Candidate */

export const BALANCE_OBJECTIVES = /** @type {const} */ (['nameplate', 'impedance', 'loadflow']);

// Weights of the load-flow objective. They are optimisation weights, not engineering data.
// One voltage violation-hour (1 MW-equivalent) outweighs any realistic neutral loss on an LV island,
// which is hundreds of watts, so violations are removed first. Each % of VUF above the standards
// profile's limit, per pole and hour, costs as much as 1 kW of neutral loss. Both can be
// overridden through opts.weights.
export const LOADFLOW_OBJECTIVE_WEIGHTS = Object.freeze({ violationW: 1e6, vufWPerPct: 1000 });

/** |Σ (Zph + Zn)| (Ω) of the spans from the transformer to `poleId`. @param {Design} design @param {string} poleId */
export function pathImpedanceOhm(design, poleId) {
  let z = C.zero(), cur = poleId;
  while (!isTransformerId(design, cur)) {
    const p = poleById(design, cur);
    if (!p) break;
    const cp = conductorParams(design, p.cond), km = p.spanM / 1000;
    z = C.add(z, { re: (cp.R + cp.Rn) * km, im: (cp.X + cp.Xn) * km });
    cur = p.parent;
  }
  return C.abs(z);
}

/** The original connection behind a balance item. @param {Design} design @param {OptimiserItem} it */
function sourceOf(design, it) {
  const list = it.kind === 'load' ? design.loads : it.kind === 'pv' ? design.pv : design.bess;
  return /** @type {any} */ (list.find(c => c.id === it.id));
}

/** @param {Phase[]} arr @param {OptimiserItem[]} items */
function changesOf(arr, items) {
  return items.map((it, i) => ({ ...it, newPhase: arr[i] })).filter(c => c.newPhase !== c.phase);
}

/** @param {Phase[]} arr @param {OptimiserItem[]} items @returns {PhaseMap<number>} */
function phaseTotals(arr, items) {
  const t = { A: 0, B: 0, C: 0 };
  items.forEach((it, i) => { t[arr[i]] += it.kva; });
  return t;
}

/** @param {PhaseMap<number>} t */
const spreadOf = (t) => Math.max(t.A, t.B, t.C) - Math.min(t.A, t.B, t.C);

/**
 * @param {Design} design
 * @param {string} txId
 * @param {{
 *   objective?: 'nameplate' | 'impedance' | 'loadflow', kMax?: number, hours?: number[], solarMult?: number, year?: number,
 *   restarts?: number, iterations?: number, seed?: number, weights?: { violationW?: number, vufWPerPct?: number }, screen?: number,
 *   withMetrics?: boolean
 * } & ProgressHooks} [opts]
 */
export function optimisePhaseBalance(design, txId, opts = {}) {
  const objective = BALANCE_OBJECTIVES.includes(/** @type {any} */ (opts.objective)) ? /** @type {'nameplate' | 'impedance' | 'loadflow'} */ (opts.objective) : 'nameplate';
  const kMax = Math.max(0, Math.floor(opts.kMax ?? 9));
  const hours = opts.hours && opts.hours.length ? opts.hours : DAILY_HOURS;
  const solarMult = opts.solarMult ?? 1, year = opts.year ?? 0;
  const restarts = Math.max(0, Math.floor(opts.restarts ?? 0)), iterations = Math.max(1, Math.floor(opts.iterations ?? 200));
  const seed = opts.seed ?? 1;
  const weights = { ...LOADFLOW_OBJECTIVE_WEIGHTS, ...(opts.weights || {}) };
  const screen = Math.max(1, Math.floor(opts.screen ?? 200));
  const onProgress = opts.onProgress;

  /** @type {OptimiserItem[]} */
  const items = balanceableConnections(design, txId).map(it => ({ ...it, weight: pathImpedanceOhm(design, it.pole) }));
  const n = items.length;
  /** @type {Phase[]} */
  const orig = items.map(it => it.phase);

  // Interchangeable connections: same kind and every field but id and phase equal.
  const groupOf = new Map();
  /** @type {number[][]} */
  const groups = [];
  items.forEach((it, i) => {
    const { id, phase, ...rest } = sourceOf(design, it);
    const sig = it.kind + '|' + JSON.stringify(rest, Object.keys(rest).sort());
    if (!groupOf.has(sig)) { groupOf.set(sig, groups.length); groups.push([]); }
    groups[groupOf.get(sig)].push(i);
  });

  // The arrangement with the same per-group phase counts and the fewest changes from today:
  // members keep their own phase while their group still needs it, the rest take the remaining
  // phases in A, B, C order.
  /** @param {Phase[]} arr @returns {Phase[]} */
  function normalise(arr) {
    const out = /** @type {Phase[]} */ (arr.slice());
    for (const g of groups) {
      if (g.length === 1) continue;
      const need = { A: 0, B: 0, C: 0 };
      g.forEach(i => { need[arr[i]]++; });
      const free = [];
      g.forEach(i => { if (need[orig[i]] > 0) { out[i] = orig[i]; need[orig[i]]--; } else free.push(i); });
      for (const ph of PHASES) while (need[ph] > 0) { out[/** @type {number} */ (free.shift())] = ph; need[ph]--; }
    }
    return out;
  }
  /** @param {Phase[]} arr */
  const movesOf = (arr) => arr.reduce((s, ph, i) => s + (ph !== orig[i] ? 1 : 0), 0);
  /** @param {Phase[]} arr */
  const keyOf = (arr) => arr.join('');

  // Only the transformer's own network is solved, for every arrangement tried.
  const sub = objective === 'loadflow' ? transformerSubDesign(design, txId) : null;
  // Per-span neutral resistance (Ω) for the neutral I²R term.
  /** @type {Record<string, number>} */
  const neutralR = {};
  if (sub) sub.poles.forEach(p => { neutralR[p.id] = conductorParams(sub, p.cond).Rn * p.spanM / 1000; });

  /** @param {Phase[]} arr */
  function impedanceSpread(arr) {
    const t = { A: 0, B: 0, C: 0 };
    items.forEach((it, i) => { t[arr[i]] += it.kva * it.weight; });
    return spreadOf(t);
  }
  /** @param {Phase[]} arr @returns {{ value: number, parts?: LoadflowParts }} */
  function score(arr) {
    if (objective === 'nameplate') return { value: spreadOf(phaseTotals(arr, items)) };
    if (objective === 'impedance') return { value: impedanceSpread(arr) };
    const d = applyPhaseBalance(/** @type {Design} */ (sub), changesOf(arr, items));
    const parts = { violations: 0, neutralLossW: 0, vufExcessPct: 0 };
    runHours(d, hours, { year, loadMult: 1, solarMult }).forEach(res => {
      res.violations.forEach(v => { if (v.type === 'undervoltage' || v.type === 'overvoltage') parts.violations++; });
      res.poleResults.forEach(pr => {
        parts.neutralLossW += pr.In * pr.In * (neutralR[pr.id] || 0);
        if (pr.vufPct > res.vufLimitPct) parts.vufExcessPct += pr.vufPct - res.vufLimitPct;
      });
    });
    return { value: weights.violationW * parts.violations + parts.neutralLossW + weights.vufWPerPct * parts.vufExcessPct, parts };
  }

  /** @type {Map<string, Candidate>} */
  const cache = new Map();
  /** @type {(Candidate | null)[]} best arrangement found with exactly d moves */
  const bestByMoves = Array(kMax + 1).fill(null);
  /** @param {number} v */
  const tol = (v) => 1e-9 * Math.max(1, Math.abs(v));
  /** @param {Phase[]} raw @param {boolean} [normalised] @returns {Candidate} */
  function evaluate(raw, normalised = false) {
    const arr = normalised ? raw : normalise(raw), key = keyOf(arr);
    let c = cache.get(key);
    if (!c) {
      c = { arr, key, d: movesOf(arr), ...score(arr) };
      cache.set(key, c);
      if (c.d <= kMax) {
        const b = bestByMoves[c.d];
        if (!b || c.value < b.value - tol(b.value)) bestByMoves[c.d] = c;
      }
    }
    return c;
  }
  // Best with ≤ K moves; ties go to fewer moves.
  /** @param {number} K @returns {Candidate} */
  function bestWithin(K) {
    let best = /** @type {Candidate} */ (bestByMoves[0]);
    for (let d = 1; d <= K; d++) {
      const c = bestByMoves[d];
      if (c && c.value < best.value - tol(best.value)) best = c;
    }
    return best;
  }
  /** Every distinct neighbour of `arr`, normalised, with its move count: single moves, then pair swaps. @param {Phase[]} arr @returns {{ arr: Phase[], d: number }[]} */
  function neighbours(arr) {
    /** @type {{ arr: Phase[], d: number }[]} */
    const out = [];
    const seen = new Set([keyOf(normalise(arr))]);
    /** @param {Phase[]} raw */
    const push = (raw) => { const nb = normalise(raw), k = keyOf(nb); if (!seen.has(k)) { seen.add(k); out.push({ arr: nb, d: movesOf(nb) }); } };
    for (let i = 0; i < n; i++) for (const ph of PHASES) if (ph !== arr[i]) { const nb = arr.slice(); nb[i] = ph; push(nb); }
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (arr[i] !== arr[j]) { const nb = arr.slice(); nb[i] = arr[j]; nb[j] = arr[i]; push(nb); }
    return out;
  }

  const start = evaluate(orig);
  const quick = proposePhaseBalance(design, txId);
  const quickPhase = new Map(quick.items.map(it => [it.kind + '|' + it.id, /** @type {Phase} */ (it.newPhase)]));
  const legacy = evaluate(items.map(it => quickPhase.get(it.kind + '|' + it.id) || it.phase));

  // Simulated-annealing restarts: random single moves and swaps within the budget, Metropolis
  // acceptance, geometric cooling from T0 (the mean |Δ| of today's single-move neighbours) to
  // T0/1000. Every arrangement visited joins the pool.
  if (restarts > 0 && n > 1 && kMax > 0) {
    const rand = mulberry32(seed);
    const firstDeltas = neighbours(orig).slice(0, 2 * n).map(nb => Math.abs(evaluate(nb.arr, true).value - start.value)).filter(x => x > 0);
    const T0 = firstDeltas.length ? firstDeltas.reduce((s, x) => s + x, 0) / firstDeltas.length : 1;
    const cool = Math.pow(1e-3, 1 / iterations);
    for (let r = 0; r < restarts; r++) {
      let cur = start, T = T0;
      for (let it = 0; it < iterations; it++, T *= cool) {
        if (onProgress && it % 10 === 0) onProgress({ stage: `Annealing restart ${r + 1} of ${restarts}`, done: it, total: iterations });
        const nb = cur.arr.slice(), i = randomInt(rand, n);
        if (rand() < 0.5) {
          const others = PHASES.filter(ph => ph !== cur.arr[i]);
          nb[i] = others[randomInt(rand, 2)];
        } else {
          const j = randomInt(rand, n);
          if (cur.arr[i] === cur.arr[j]) continue;
          nb[i] = cur.arr[j]; nb[j] = cur.arr[i];
        }
        const c = evaluate(nb);
        if (c.d > kMax) continue;
        if (c.value <= cur.value || rand() < Math.exp(-(c.value - cur.value) / T)) cur = c;
      }
    }
  }

  // Steepest descent under each budget K, from the best found so far with ≤ K moves.
  for (let K = 1; K <= kMax && n > 0; K++) {
    let cur = bestWithin(K);
    for (;;) {
      let nbs = neighbours(cur.arr).filter(nb => nb.d <= K).map(nb => nb.arr);
      // Screening for the load-flow objective on big transformers: a step has ~n²/3 swaps, each a
      // full multi-hour load flow. Above `screen` neighbours, only those ranked best by the
      // impedance-weighted spread (cheap, and a good proxy for voltage drop and neutral current)
      // are solved. The fixture (20 connections) stays below the limit, so it is searched in full.
      if (objective === 'loadflow' && nbs.length > screen) {
        nbs = nbs.map((nb, idx) => ({ nb, idx, s: impedanceSpread(nb) }))
          .sort((a, b) => a.s - b.s || a.idx - b.idx).slice(0, screen).map(x => x.nb);
      }
      /** @type {Candidate | null} */
      let bestNb = null;
      nbs.forEach((nb, idx) => {
        if (onProgress && objective === 'loadflow') onProgress({ stage: `Local search, up to ${K} of ${kMax} moves`, done: idx + 1, total: nbs.length });
        const c = evaluate(nb, true);
        if (!bestNb || c.value < bestNb.value - tol(bestNb.value) || (Math.abs(c.value - bestNb.value) <= tol(bestNb.value) && c.d < bestNb.d)) bestNb = c;
      });
      if (bestNb && /** @type {Candidate} */ (bestNb).value < cur.value - tol(cur.value)) cur = bestNb; else break;
    }
    if (onProgress && objective !== 'loadflow') onProgress({ stage: 'Local search', done: K, total: kMax });
  }

  // Scan metrics (whole design, the same hours) for each distinct row, as the legacy page shows.
  /** @type {Map<string, any>} */
  const metricsCache = new Map();
  /** @param {Candidate} c */
  function metricsOf(c) {
    if (opts.withMetrics === false) return null;
    if (!metricsCache.has(c.key)) {
      metricsCache.set(c.key, summarizeScan(runHours(applyPhaseBalance(design, changesOf(c.arr, items)), hours, { year, loadMult: 1, solarMult })));
    }
    return metricsCache.get(c.key);
  }
  /** @param {Candidate} c */
  const describe = (c) => ({
    moves: c.d, objectiveValue: c.value, parts: c.parts || null,
    changed: changesOf(c.arr, items), after: phaseTotals(c.arr, items)
  });
  const pareto = [];
  for (let K = 0; K <= kMax; K++) {
    if (onProgress && opts.withMetrics !== false) onProgress({ stage: 'Scanning each row', done: K + 1, total: kMax + 1 });
    const c = bestWithin(K);
    pareto.push({ k: K, ...describe(c), metrics: metricsOf(c) });
  }
  const bestValue = pareto[pareto.length - 1].objectiveValue;
  const recommendedK = /** @type {number} */ (pareto.find(r => r.objectiveValue <= bestValue + tol(bestValue))?.k ?? 0);
  return {
    objective, kMax, hours, solarMult, year, seed, restarts, iterations, weights,
    items, before: phaseTotals(orig, items),
    pareto, recommendedK,
    legacy: { ...describe(legacy), metrics: metricsOf(legacy) },
    evaluations: cache.size
  };
}
