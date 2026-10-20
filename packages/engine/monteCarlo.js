// @ts-check
// Probabilistic (Monte Carlo) planning (P4.4). Each run randomly gives a share of the eligible
// customers an EV charger and/or rooftop PV, then solves the critical hours (or the full day).
// Over many runs that gives the probability of a violation anywhere, per pole-phase, and the
// spread of minimum / maximum voltage, transformer peak loading and losses.
//
// Choices (all stated in the UI too):
//   - Eligible customers are the design's general (household) loads. Each run picks exactly
//     round(adoption % × customers) of them for EVs, and independently the same way for PV,
//     uniformly without replacement. A fixed count, rather than a coin toss per customer, keeps
//     the number adopted at the stated %, so the spread reflects *where* adoption lands.
//   - The new EV / PV sits on the customer's own pole and phase. Its size is drawn from a discrete
//     distribution: kVA values with weights. These are never invented. The defaults are the sizes
//     already in the design (its EV loads and PV units, each counted once per occurrence), and
//     the user can edit them. With adoption > 0 and no sizes, the run is refused ("data missing").
//   - Existing EVs and PV stay as they are. If the design has EVs or solar switched off in Setup
//     but adoption is asked for, they are switched on for the study (reported in `forcedOn`).
//   - The PRNG is mulberry32 (random.js) seeded from `seed`, one stream for the whole study, so
//     the same inputs and seed give identical results.
import { runHours, systemLossW } from './scan.js';
import { mulberry32, randomInt } from './random.js';
/** @import { Design, Phase, ProgressHooks, SnapshotResult } from './types.js' */
/** @typedef {{ kva: number, weight: number }} SizeOption */

/** The default "critical hours": solar peak (12:00) and the evening peak (20:00). */
export const MC_CRITICAL_HOURS = Object.freeze([12, 20]);
export const MC_QUANTILES = Object.freeze([5, 10, 50, 90, 95]);

/**
 * Size distributions taken from the design itself: each EV load / PV unit's kVA counted once.
 * Empty when the design has none — the user must then enter sizes.
 * @param {Design} design @returns {{ ev: SizeOption[], pv: SizeOption[] }}
 */
export function adoptionSizesFromDesign(design) {
  /** @param {number[]} values */
  const tally = (values) => {
    /** @type {Map<number, number>} */
    const m = new Map();
    values.filter(v => Number.isFinite(v) && v > 0).forEach(v => m.set(v, (m.get(v) || 0) + 1));
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([kva, weight]) => ({ kva, weight }));
  };
  return {
    ev: tally(design.loads.filter(l => l.type === 'ev' && l.kva != null && /** @type {any} */ (l.kva) !== '').map(l => Number(l.kva))),
    pv: tally(design.pv.map(p => Number(p.kva)))
  };
}

/** Valid size options only (finite kVA > 0, weight > 0). @param {any} list @returns {SizeOption[]} */
function cleanSizes(list) {
  return (Array.isArray(list) ? list : [])
    .map(o => ({ kva: Number(o && o.kva), weight: o && o.weight != null ? Number(o.weight) : 1 }))
    .filter(o => Number.isFinite(o.kva) && o.kva > 0 && Number.isFinite(o.weight) && o.weight > 0);
}

/** @param {() => number} rand @param {SizeOption[]} sizes */
function drawSize(rand, sizes) {
  const total = sizes.reduce((s, o) => s + o.weight, 0);
  let x = rand() * total;
  for (const o of sizes) { x -= o.weight; if (x < 0) return o.kva; }
  return sizes[sizes.length - 1].kva;
}

/** k distinct indices from [0, n), uniformly (partial Fisher–Yates). @param {() => number} rand @param {number} n @param {number} k */
function sampleIndices(rand, n, k) {
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = 0; i < k; i++) {
    const j = i + randomInt(rand, n - i);
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, k);
}

/** Linear-interpolated quantile (q in %), of a sorted array. @param {number[]} sorted @param {number} q */
export function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q / 100, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Equal-width histogram. @param {number[]} values @param {number} bins */
export function histogram(values, bins = 20) {
  if (!values.length) return { edges: [], counts: [] };
  const lo = Math.min(...values), hi = Math.max(...values);
  if (hi - lo < 1e-12) return { edges: [lo, hi], counts: [values.length] };
  const w = (hi - lo) / bins;
  const counts = Array(bins).fill(0);
  values.forEach(v => { counts[Math.min(bins - 1, Math.floor((v - lo) / w))]++; });
  return { edges: Array.from({ length: bins + 1 }, (_, i) => lo + i * w), counts };
}

/** What one run's snapshots show. @param {SnapshotResult[]} snaps */
export function runMetrics(snaps) {
  let minV = Infinity, maxV = -Infinity, txPeakPct = 0, lossKwh = 0;
  /** @type {Set<string>} */
  const nodes = new Set();
  let anyViolation = false;
  snaps.forEach(s => {
    if (s.violations.length) anyViolation = true;
    s.violations.forEach(v => { if (v.phase !== '-') nodes.add(v.pole + '|' + v.phase); });
    s.poleResults.forEach(pr => { for (const ph of /** @type {Phase[]} */ (['A', 'B', 'C'])) { const v = pr.volt[ph]; if (v < minV) minV = v; if (v > maxV) maxV = v; } });
    s.transformers.forEach(t => { if (t.txPct > txPeakPct) txPeakPct = t.txPct; });
    lossKwh += systemLossW(s).totalLossW / 1000;
  });
  return { anyViolation, violatingNodes: [...nodes].sort(), minV, maxV, txPeakPct, lossKwh, converged: snaps.every(s => s.converged) };
}

/**
 * @param {Design} design
 * @param {{ year?: number, evPct?: number, pvPct?: number, evSizes?: SizeOption[], pvSizes?: SizeOption[], runs?: number, seed?: number,
 *   hours?: number[], loadMult?: number, solarMult?: number } & ProgressHooks} [opts]
 */
export function monteCarloStudy(design, opts = {}) {
  const year = opts.year ?? 0, runs = Math.max(1, Math.floor(opts.runs ?? 500)), seed = opts.seed ?? 1;
  const evPct = Math.min(100, Math.max(0, Number(opts.evPct) || 0)), pvPct = Math.min(100, Math.max(0, Number(opts.pvPct) || 0));
  const hours = opts.hours && opts.hours.length ? [...opts.hours] : [...MC_CRITICAL_HOURS];
  const loadMult = opts.loadMult ?? 1, solarMult = opts.solarMult ?? 1;
  const defaults = adoptionSizesFromDesign(design);
  const evSizes = opts.evSizes ? cleanSizes(opts.evSizes) : defaults.ev;
  const pvSizes = opts.pvSizes ? cleanSizes(opts.pvSizes) : defaults.pv;
  if (evPct > 0 && !evSizes.length) throw new Error('EV charger sizes are missing: enter at least one EV size (kVA), or add EV loads to the design.');
  if (pvPct > 0 && !pvSizes.length) throw new Error('PV system sizes are missing: enter at least one PV size (kVA), or add PV to the design.');

  const customers = design.loads.filter(l => l.type === 'general');
  const nEv = Math.round(evPct / 100 * customers.length), nPv = Math.round(pvPct / 100 * customers.length);
  const forcedOn = { ev: nEv > 0 && !design.includeEV, solar: nPv > 0 && !design.includeSolar };
  const study = { ...design, includeEV: design.includeEV || nEv > 0, includeSolar: design.includeSolar || nPv > 0 };
  const base = { year, loadMult, solarMult };

  const baseMetrics = runMetrics(runHours(design, hours, base));
  const rand = mulberry32(seed);
  const results = [];
  for (let r = 0; r < runs; r++) {
    const evs = sampleIndices(rand, customers.length, nEv).map((i, k) => {
      const c = customers[i];
      return { id: `MC-EV${k + 1}`, pole: c.pole, type: /** @type {'ev'} */ ('ev'), phase: c.phase, kva: drawSize(rand, evSizes) };
    });
    const pvs = sampleIndices(rand, customers.length, nPv).map((i, k) => {
      const c = customers[i];
      return { id: `MC-PV${k + 1}`, pole: c.pole, phase: c.phase, kva: drawSize(rand, pvSizes) };
    });
    const d = nEv || nPv ? { ...study, loads: [...design.loads, ...evs], pv: [...design.pv, ...pvs] } : design;
    results.push({ ...runMetrics(runHours(d, hours, base)), evAt: evs.map(e => `${e.pole} ${e.phase} ${e.kva}`), pvAt: pvs.map(p => `${p.pole} ${p.phase} ${p.kva}`) });
    if (opts.onProgress) opts.onProgress({ stage: 'Monte Carlo runs', done: r + 1, total: runs });
  }

  /** @type {Record<string, number>} */
  const nodeCounts = {};
  results.forEach(m => m.violatingNodes.forEach(k => { nodeCounts[k] = (nodeCounts[k] || 0) + 1; }));
  const nodeProbability = design.poles.map(p => ({
    pole: p.id,
    A: (nodeCounts[p.id + '|A'] || 0) / runs, B: (nodeCounts[p.id + '|B'] || 0) / runs, C: (nodeCounts[p.id + '|C'] || 0) / runs
  }));
  /** @param {'minV' | 'maxV' | 'txPeakPct' | 'lossKwh'} key */
  const dist = (key) => {
    const values = results.map(m => m[key]);
    const sorted = [...values].sort((a, b) => a - b);
    return {
      quantiles: Object.fromEntries(MC_QUANTILES.map(q => ['P' + q, quantile(sorted, q)])),
      mean: values.reduce((s, v) => s + v, 0) / values.length,
      histogram: histogram(values)
    };
  };
  return {
    inputs: { year, evPct, pvPct, evSizes, pvSizes, runs, seed, hours, loadMult, solarMult },
    customers: customers.length, evPerRun: nEv, pvPerRun: nPv, forcedOn,
    base: baseMetrics,
    probabilityAnyViolation: results.filter(m => m.anyViolation).length / runs,
    nodeProbability,
    distributions: { minV: dist('minV'), maxV: dist('maxV'), txPeakPct: dist('txPeakPct'), lossKwh: dist('lossKwh') },
    nonConvergedRuns: results.filter(m => !m.converged).length,
    runs: results
  };
}
