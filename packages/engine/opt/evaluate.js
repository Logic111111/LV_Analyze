// @ts-check
// Design evaluation for the optimisers (O1.4): one call runs the full load flows for the chosen
// years and hours and boils them down to what the objectives compare — violations by type, loss,
// voltage extremes and margin, convergence and any reverse-flow overload.
//
// Optimisers revisit the same design often (a neighbour of a neighbour, a restart reaching the
// same arrangement), so evaluations go through an LRU cache keyed by a canonical design
// signature. Identical connections (same pole, type, size — everything but id) are
// interchangeable: the signature drops ids and sorts the connection lists, so "house L7 on B,
// house L8 on A" and "L7 on A, L8 on B" are one design and are solved once. On the fixture this
// turns the 40 raw single moves into 20 distinct designs.
import { PHASES } from '../complex.js';
import { runHours, systemLossW, DAILY_HOURS } from '../scan.js';
/** @import { Design, PvConnection, BessConnection, SnapshotResult } from '../types.js' */

// Fields that never change a load flow (labels, plans, money, protection data): left out of the
// signature so they don't split the cache.
const NON_ELECTRICAL = new Set(['name', 'id', 'updatedAt', 'scenarios', 'signOff', 'map', 'economics', 'protection', 'fault', 'fuseLibrary']);
const CONNECTIONS = new Set(['loads', 'pv', 'bess']);

/** JSON with object keys sorted, so equal content gives an equal string. @param {any} v @returns {string} */
export function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

/** Canonical signature of everything in a design that affects a load flow (see the module comment). @param {Design} design */
export function designSignature(design) {
  const parts = Object.keys(design).filter(k => !NON_ELECTRICAL.has(k)).sort().map(k => {
    const v = /** @type {any} */ (design)[k];
    if (CONNECTIONS.has(k) && Array.isArray(v)) {
      return JSON.stringify(k) + ':[' + v.map(c => { const { id: _id, ...rest } = c; return stableStringify(rest); }).sort().join(',') + ']';
    }
    return JSON.stringify(k) + ':' + stableStringify(v);
  });
  return '{' + parts.join(',') + '}';
}

/**
 * @typedef {object} EvalOptions
 * @property {number[]} [years]      default [0]
 * @property {number[]} [hours]      default every hour
 * @property {number} [loadMult]
 * @property {number} [solarMult]
 * @property {PvConnection[]} [extraPV]
 * @property {BessConnection[]} [extraBess]
 * @property {boolean} [txLimitBothDirections] override the design's standards setting (O3.5)
 */
/**
 * @typedef {object} Evaluation
 * @property {{ voltage: number, thermal: number, transformer: number, vuf: number }} violations  violation-hours by type, all years
 * @property {number} total
 * @property {Record<number, number>} byYear  violation-hours per year
 * @property {number} lossKwh  network loss over the scanned hours of the first year, kWh (the daily loss when every hour is scanned)
 * @property {{ value: number, pole: string, phase: string, hour: number, year: number }} minV
 * @property {{ value: number, pole: string, phase: string, hour: number, year: number }} maxV
 * @property {number} marginV  smallest distance to the voltage band (negative = outside), V
 * @property {boolean} converged
 * @property {{ txId: string, pct: number, hour: number, year: number } | null} reverseFlowMax  highest transformer loading while exporting
 */

/** The design with the transformer limit applied both ways or import-only (O3.5). @param {Design} design @param {boolean | undefined} both */
export function withTxLimitRule(design, both) {
  if (both === undefined || !!(design.standards && /** @type {any} */ (design.standards).txLimitBothDirections) === both) return design;
  return { ...design, standards: { ...(design.standards || /** @type {any} */ ({})), txLimitBothDirections: both } };
}

/**
 * Full load flows of `design` at every (year, hour) and the summary the optimisers compare.
 * @param {Design} design @param {EvalOptions} [opts]
 * @returns {Evaluation}
 */
export function evaluateDesign(design, opts = {}) {
  const years = opts.years && opts.years.length ? opts.years : [0];
  const hours = opts.hours && opts.hours.length ? opts.hours : DAILY_HOURS;
  const d = withTxLimitRule(design, opts.txLimitBothDirections);
  const violations = { voltage: 0, thermal: 0, transformer: 0, vuf: 0 };
  /** @type {Record<number, number>} */
  const byYear = {};
  let lossKwh = 0, converged = true;
  let minV = { value: Infinity, pole: '', phase: '', hour: -1, year: -1 }, maxV = { value: -Infinity, pole: '', phase: '', hour: -1, year: -1 };
  /** @type {Evaluation['reverseFlowMax']} */
  let reverseFlowMax = null;
  let vLow = 0, vHigh = 0;
  years.forEach((year, yi) => {
    const snaps = runHours(d, hours, { year, loadMult: opts.loadMult ?? 1, solarMult: opts.solarMult ?? 1, extraPV: opts.extraPV || [], extraBess: opts.extraBess || [] });
    let count = 0;
    snaps.forEach((/** @type {SnapshotResult} */ res) => {
      if (!res.converged) converged = false;
      vLow = res.vLimLow; vHigh = res.vLimHigh;
      res.violations.forEach(v => {
        count++;
        if (v.type === 'undervoltage' || v.type === 'overvoltage') violations.voltage++;
        else if (v.type === 'thermal') violations.thermal++;
        else if (v.type === 'transformer overload') violations.transformer++;
        else if (v.type === 'unbalance') violations.vuf++;
      });
      res.poleResults.forEach(pr => PHASES.forEach(ph => {
        const v = pr.volt[ph];
        if (v < minV.value) minV = { value: v, pole: pr.id, phase: ph, hour: res.hour, year };
        if (v > maxV.value) maxV = { value: v, pole: pr.id, phase: ph, hour: res.hour, year };
      }));
      res.transformers.forEach(t => {
        if (t.flowDirection === 'export' && (!reverseFlowMax || t.txPct > reverseFlowMax.pct)) reverseFlowMax = { txId: t.id, pct: t.txPct, hour: res.hour, year };
      });
      if (yi === 0) lossKwh += systemLossW(res).totalLossW / 1000;
    });
    byYear[year] = count;
  });
  const total = violations.voltage + violations.thermal + violations.transformer + violations.vuf;
  const marginV = Math.min(minV.value - vLow, vHigh - maxV.value);
  return { violations, total, byYear, lossKwh, minV, maxV, marginV, converged, reverseFlowMax };
}

/**
 * Lexicographic comparison of objective tuples (smaller is better): negative when `a` is
 * better, positive when `b` is, 0 when equal within `tol` in every place.
 * @param {number[]} a @param {number[]} b @param {number} [tol]
 */
export function compareLex(a, b, tol = 1e-9) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0;
    if (Math.abs(x - y) > tol * Math.max(1, Math.abs(x), Math.abs(y))) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * An evaluateDesign with an LRU cache (default 5 000 designs).
 * @param {{ capacity?: number }} [opts]
 */
export function createEvaluator(opts = {}) {
  const capacity = opts.capacity ?? 5000;
  /** @type {Map<string, Evaluation>} */
  const cache = new Map();
  let hits = 0, misses = 0;
  const keyOf = (/** @type {Design} */ design, /** @type {EvalOptions} */ o) => designSignature(design) + '#' + stableStringify(o);
  return {
    /** @param {Design} design @param {EvalOptions} [o] @returns {Evaluation} */
    evaluate(design, o = {}) {
      const key = keyOf(design, o);
      const got = cache.get(key);
      if (got) { hits++; cache.delete(key); cache.set(key, got); return got; }
      misses++;
      const r = evaluateDesign(design, o);
      cache.set(key, r);
      if (cache.size > capacity) cache.delete(/** @type {string} */ (cache.keys().next().value));
      return r;
    },
    /** @param {Design} design @param {EvalOptions} [o] */
    has(design, o = {}) { return cache.has(keyOf(design, o)); },
    stats() { return { hits, misses, size: cache.size }; },
    clear() { cache.clear(); }
  };
}
