// @ts-check
// Hosting capacity that is optimal (O3.2) and fair (O3.3), beside the legacy first-come queue.
//
// Why a queue isn't the maximum: it approves locations one at a time (largest independent
// capacity first) and locks each approval in, assuming every addition only uses up headroom. On a
// 4-wire network that's false: PV on phase A raises A but, through the shared neutral, pulls B and
// C down, so balanced injections on all three phases at a pole cancel most of the neutral voltage
// rise and the pole hosts far more in total than any one phase alone. The total therefore depends
// on the order of approval, and the right question — "how much PV can be added at once?" — is an
// optimisation over all locations together.
//
// Successive linear programming (SLP) with a trust region (hostingMaxTotalSLP):
//   1. Start at x = 0 (kVA per location), trust region Δ = 10 kVA per location.
//   2. Solve the test hours with x in place; linearise every pole-phase voltage, span loading and
//      transformer kVA in x (opt/sensitivity.js — exact first-order derivatives of the sweep).
//   3. LP: maximise Σ Δx subject to, at every hour, V + J_V·Δx inside the band less a small margin,
//      loading + J_L·Δx ≤ 99.9 % of the limit, transformer kVA% + J_T·Δx ≤ 99.9 % (only when the
//      limit applies to reverse flow — O3.5), the trust region and the per-location caps. Limits
//      are relative to what's there already, as in the legacy search: a location or hour already
//      outside a limit may not get worse, but isn't required to improve.
//   4. Candidate x' = (x + Δx) floored to 0.05 kVA. Verify it with full load flows at every test
//      hour (no new or worsened violation, converged). Accepted: x = x' and Δ grows ×1.5 (to 40)
//      if the total rose by ≥ 0.05, else Δ halves. Rejected: Δ halves, the margin grows ×1.2,
//      and the rows that failed are tightened by their overshoot, so the next linearisation is
//      more cautious exactly where it was wrong.
//   5. Stop when Δ < 0.2 with no gain, or at the iteration / load-flow budget.
// Every reported allocation has passed full load flows. The LP solved once more at the final point
// with no trust region is the optimistic estimate (certificate 'lp-bound'): the gap says how much
// more the linear model thinks might fit — as far as the linearisation holds.
//
// BESS: the same, direction-aware. In charge hours a battery is load (kVA × |schedule|): only the
// lower voltage limit, loading and transformer import bind. In discharge hours it is generation
// derated by the round-trip efficiency, as the engine dispatches it: the upper voltage limit,
// loading and (both-directions rule only) transformer. Violations are judged with the BESS
// relevance filter of the legacy search.
//
// Fair share (hostingFairShare): the largest uniform size s such that every location hosting s at
// once passes — a one-dimensional search on s with the O3.1 safeguards (floored result, converged
// solves only, baseline-relative judging, monotonicity probe).
import { PHASES } from '../complex.js';
import { runSnapshot, warmStartFrom, topologyOf } from '../solver.js';
import { connectionIndex, rangeHours, bessMultiplierAt } from '../loads.js';
import { standardsOf } from '../standards.js';
import { HOSTING_TEST_HOURS, hostingBaseline, newOrWorsenedViolation, UNCAPPED_CEILING_KVA } from '../hosting.js';
import { bessRelevantViolations } from '../bess.js';
import { networkJacobian, finiteDifferenceJacobian, semiAnalyticSupported } from './sensitivity.js';
import { solveLPRowGeneration } from './lp.js';
import { withTxLimitRule } from './evaluate.js';
import { optResult, nowMs, elapsedMs } from './result.js';
/** @import { Design, Phase, SnapshotResult, ProgressHooks } from '../types.js' */
/** @typedef {import('./sensitivity.js').Location} HostingLocation */

const STEP = 20; // 0.05 kVA grid
const floorStep = (/** @type {number} */ v) => Math.floor(v * STEP + 1e-9) / STEP;

/** Every pole-phase of the design, in design order. @param {Design} design @returns {HostingLocation[]} */
export function allLocations(design) { return design.poles.flatMap(p => PHASES.map(ph => ({ pole: p.id, phase: /** @type {Phase} */ (ph) }))); }

/**
 * Shared machinery: the test hours, the baseline, and a verifier for an allocation.
 * @param {Design} design0 @param {'pv' | 'bess'} kind @param {boolean | undefined} txBoth @param {number[] | undefined} hoursIn
 */
function hostingContext(design0, kind, txBoth, hoursIn) {
  const design = withTxLimitRule(design0, txBoth);
  const hours = hoursIn && hoursIn.length ? hoursIn
    : kind === 'pv' ? HOSTING_TEST_HOURS
      : [...rangeHours(design.bessChargeStartHour, design.bessChargeEndHour), ...rangeHours(design.bessDischargeStartHour, design.bessDischargeEndHour)];
  const relevant = kind === 'pv' ? (/** @type {number} */ _h, /** @type {any[]} */ vs) => vs : (/** @type {number} */ h, /** @type {any[]} */ vs) => bessRelevantViolations(design, h, vs);
  const baseline = hostingBaseline(design, hours, relevant);
  const ctx = { index: connectionIndex(design), topo: topologyOf(design) };
  const warm = new Map(baseline.startByHour);
  let loadFlows = 0;
  /** @param {HostingLocation[]} locs @param {number[]} x */
  const extras = (locs, x) => {
    const list = locs.map((l, i) => ({ pole: l.pole, phase: l.phase, kva: x[i] })).filter(e => e.kva > 0);
    return kind === 'pv' ? { extraPV: list, extraBess: [] } : { extraPV: [], extraBess: list };
  };
  /**
   * Full load flows of an allocation at every test hour: null if it passes, else why not.
   * @param {HostingLocation[]} locs @param {number[]} x @param {Map<number, SnapshotResult>} [keep] filled with each hour's result
   */
  const verify = (locs, x, keep) => {
    const ex = extras(locs, x);
    for (const h of hours) {
      const res = runSnapshot(design, { year: 0, hour: h, loadMult: 1, solarMult: 1, ...ex, bessDispatch: baseline.dispatchByHour ? baseline.dispatchByHour.get(h) : null }, { ...ctx, initialV: warm.get(h) || null });
      loadFlows++;
      if (res.status === 'collapse') return { reason: 'collapse', detail: { hour: h } };
      if (!res.converged) return { reason: 'nonConvergence', detail: { hour: h } };
      warm.set(h, warmStartFrom(res));
      if (keep) keep.set(h, res);
      const baseAt = /** @type {Map<string, any>} */ (baseline.byHour.get(h));
      const v = newOrWorsenedViolation(relevant(h, res.violations), baseAt);
      // Every new or worsened violation at the failing hour, for the optimiser's row learning.
      if (v) return { reason: 'violation', detail: { hour: h, ...v }, all: relevant(h, res.violations).filter(x => newOrWorsenedViolation([x], baseAt)).map(x => ({ hour: h, ...x })) };
    }
    return null;
  };
  return { design, hours, baseline, verify, extras, loadFlows: () => loadFlows };
}

/**
 * Maximum simultaneous hosting by SLP (see the module comment).
 * @param {Design} design0
 * @param {{ kind?: 'pv' | 'bess', locations?: HostingLocation[], hours?: number[], caps?: number | number[], txLimitBothDirections?: boolean,
 *   marginV?: number, maxIterations?: number, loadFlowBudget?: number, start?: number[] } & ProgressHooks} [opts]
 */
export function hostingMaxTotalSLP(design0, opts = {}) {
  const t0 = nowMs();
  const kind = opts.kind === 'bess' ? 'bess' : 'pv';
  const locs = opts.locations && opts.locations.length ? opts.locations : allLocations(design0);
  const n = locs.length;
  const capsIn = opts.caps;
  const caps = locs.map((_, i) => { const c = Array.isArray(capsIn) ? capsIn[i] : capsIn; return Number.isFinite(c) && /** @type {number} */ (c) >= 0 ? /** @type {number} */ (c) : UNCAPPED_CEILING_KVA; });
  const maxIterations = opts.maxIterations ?? 80, budget = opts.loadFlowBudget ?? 3000;
  const progress = opts.onProgress || (() => {});
  const H = hostingContext(design0, kind, opts.txLimitBothDirections, opts.hours);
  const { design, hours } = H;
  const lim = standardsOf(design);
  const rte = design.bessRte ?? 1;
  // Generation per kVA of the unit at an hour: PV 1; BESS +rte discharging, −1 charging, 0 idle.
  const genPerKva = (/** @type {number} */ h) => (kind === 'pv' ? 1 : (m => (m > 0 ? m * rte : m))(bessMultiplierAt(design, h)));
  const notes = [];
  if (H.baseline.violations.length) notes.push(`${H.baseline.violations.length} violation-hour(s) already exist at the test hours; they may not get worse, but don't block hosting.`);
  if (H.baseline.nonConvergedHours.length) notes.push(`The design itself doesn't converge at ${H.baseline.nonConvergedHours.join(', ')}:00.`);

  let x = opts.start ? opts.start.map((v, i) => Math.min(floorStep(Math.max(v, 0)), caps[i])) : Array(n).fill(0);
  /** @type {Map<number, SnapshotResult>} */
  let atX = new Map();
  if (H.verify(locs, x, atX)) { x = Array(n).fill(0); atX = new Map(); H.verify(locs, x, atX); notes.push('The warm start failed verification; started from zero.'); }
  let delta = 10, margin = opts.marginV ?? 0.02;
  // Row learning: when a verified step fails, the rows that failed are tightened by how far they
  // overshot (plus 5 mV / 0.05 %), so the next linearisation stays clear of exactly those limits
  // rather than shrinking every step. Near an existing violation the allowed change is only the
  // 0.01 tolerance, and the linearisation's second-order error alone can exceed that.
  /** @type {Map<string, number>} */
  const rowExtra = new Map();
  const lim0 = standardsOf(design);
  const learn = (/** @type {any[]} */ failures) => failures.forEach(f => {
    const baseAt = /** @type {Map<string, any>} */ (H.baseline.byHour.get(f.hour));
    const b = baseAt.get(`${f.pole}|${f.phase}|${f.type}`);
    const vLow = lim0.vnom * (1 - lim0.vdevPct / 100), vHigh = lim0.vnom * (1 + lim0.vdevPct / 100);
    const allowed = f.type === 'undervoltage' ? (b ? b.value - 0.01 : vLow)
      : f.type === 'overvoltage' ? (b ? b.value + 0.01 : vHigh)
        : f.type === 'thermal' ? (b ? b.value + 0.01 : lim0.cableLoadingLimitPct)
          : (b ? b.value + 0.01 : lim0.txLoadingLimitPct);
    const over = f.type === 'undervoltage' ? allowed - f.value : f.value - allowed;
    const key = `${f.hour}|${f.pole}|${f.phase}|${f.type}`;
    rowExtra.set(key, (rowExtra.get(key) || 0) + Math.max(0, over) + 0.005);
  });
  const extra = (/** @type {number} */ h, /** @type {string} */ pole, /** @type {string} */ phase, /** @type {string} */ type) => rowExtra.get(`${h}|${pole}|${phase}|${type}`) || 0;
  const trace = [];
  /** @type {{ objective: number, x: number[] } | null} */
  let lastLp = null;

  /** The LP rows for the linearisation at `atX` (see the module comment), with trust region `d`. @param {number} d */
  const buildLp = (d) => {
    /** @type {number[][]} */ const A = []; /** @type {number[]} */ const b = [];
    hours.forEach(h => {
      const res = /** @type {SnapshotResult} */ (atX.get(h));
      const g = genPerKva(h);
      if (g === 0) return;
      const ex = H.extras(locs, x);
      const J = semiAnalyticSupported(design, res) ? networkJacobian(design, res, locs)
        : finiteDifferenceJacobian(design, { year: 0, hour: h, loadMult: 1, solarMult: 1, ...ex }, locs, { base: res });
      const baseAt = /** @type {Map<string, any>} */ (H.baseline.byHour.get(h));
      const charging = kind === 'bess' && g < 0, discharging = kind === 'bess' && g > 0;
      J.volt.forEach(v => {
        const row = v.grad.map(gr => gr * g);
        if (row.every(a => Math.abs(a) < 1e-12)) return;
        const bU = baseAt.get(`${v.pole}|${v.phase}|overvoltage`), bL = baseAt.get(`${v.pole}|${v.phase}|undervoltage`);
        if (!charging) { const U = Math.max(Math.max(res.vLimHigh - margin, bU ? bU.value + 0.009 : -Infinity) - extra(h, v.pole, v.phase, 'overvoltage'), v.value); A.push(row); b.push(U - v.value); }
        if (!discharging) { const L = Math.min(Math.min(res.vLimLow + margin, bL ? bL.value - 0.009 : Infinity) + extra(h, v.pole, v.phase, 'undervoltage'), v.value); A.push(row.map(a => -a)); b.push(v.value - L); }
      });
      J.spans.forEach(s => {
        const row = s.grad.map(gr => gr * g);
        if (row.every(a => Math.abs(a) < 1e-12)) return;
        const bT = baseAt.get(`${s.pole}|${s.phase}|thermal`);
        const U = Math.max(Math.max(lim.cableLoadingLimitPct * 0.999, bT ? bT.value + 0.009 : -Infinity) - extra(h, s.pole, s.phase, 'thermal'), s.pct);
        A.push(row); b.push(U - s.pct);
      });
      J.tx.forEach(t => {
        // Import counts always (a charging battery can overload it); export only under O3.5. (A
        // step that crosses from import into export is caught by the verification instead.)
        if (t.netKW < 0 && !lim.txLimitBothDirections) return;
        const pct = t.pct, row = t.grad.map(gr => gr * g / t.ratingKva * 100);
        const bX = baseAt.get(`${t.id}|-|transformer overload`);
        const U = Math.max(Math.max(lim.txLoadingLimitPct * 0.999, bX ? bX.value + 0.009 : -Infinity) - extra(h, t.id, '-', 'transformer overload'), pct);
        A.push(row); b.push(U - pct);
      });
    });
    const l = x.map(v => -Math.min(v, d)), u = x.map((v, i) => Math.max(0, Math.min(d, caps[i] - v)));
    return { c: Array(n).fill(1), A, b, l, u };
  };

  // Trust-region restarts: when the region collapses after a failed verification (not for lack of
  // gain), the search restarts from the verified point with Δ = 2 and everything it learned —
  // up to RESTARTS times. Large networks need this: many locations moving together make even a
  // small per-location step nonlinear near existing violations.
  const RESTARTS = 6;
  let it = 0;
  for (let reset = 0; reset <= RESTARTS && it < maxIterations && H.loadFlows() < budget; reset++) {
    if (reset > 0) { delta = 2; trace.push({ it, delta, margin, total: x.reduce((s, v) => s + v, 0), accepted: false, why: 'trust region reset after a rejected step' }); }
    let endedOnReject = false;
    for (; it < maxIterations && H.loadFlows() < budget; it++) {
      progress({ stage: `Linear programme ${it + 1} (total ${x.reduce((s, v) => s + v, 0).toFixed(2)} kVA)`, done: Math.min(H.loadFlows(), budget), total: budget });
      const lp = solveLPRowGeneration(buildLp(delta), { batch: 40 });
      if (lp.status !== 'optimal') { trace.push({ it, delta, margin, status: lp.status }); delta /= 2; if (delta < 0.2) break; continue; }
      const cand = x.map((v, i) => Math.min(caps[i], Math.max(0, floorStep(v + lp.x[i]))));
      const gain = cand.reduce((s, v) => s + v, 0) - x.reduce((s, v) => s + v, 0);
      // Flooring to the grid can turn a small LP gain into a loss: never step to a smaller total.
      if (cand.every((v, i) => v === x[i]) || gain < -1e-9) {
        trace.push({ it, delta, margin, lpGain: lp.objective, total: x.reduce((s, v) => s + v, 0), accepted: false, why: 'no gain on the 0.05 kVA grid' });
        endedOnReject = false;
        delta /= 2;
        if (delta < 0.2) break;
        continue;
      }
      /** @type {Map<number, SnapshotResult>} */
      const keep = new Map();
      const fail = H.verify(locs, cand, keep);
      if (!fail) {
        x = cand; atX = keep; endedOnReject = false;
        delta = gain >= 0.05 ? Math.min(delta * 1.5, 40) : delta / 2;
        trace.push({ it, delta, margin, lpGain: lp.objective, total: x.reduce((s, v) => s + v, 0), accepted: true });
        if (gain < 0.05 && delta < 0.2) break;
      } else {
        const det = /** @type {any} */ (fail.detail);
        trace.push({ it, delta, margin, lpGain: lp.objective, total: x.reduce((s, v) => s + v, 0), accepted: false, why: fail.reason + (det.pole ? ` at ${det.pole} ${det.phase}, ${det.hour}:00` : ` at ${det.hour}:00`) });
        if (/** @type {any} */ (fail).all) learn(/** @type {any} */ (fail).all);
        endedOnReject = true;
        delta /= 2; margin *= 1.2;
        if (delta < 0.2) break;
      }
    }
    it++;
    if (!endedOnReject) break;
  }
  // Optimistic estimate: the LP at the final point with no trust region (caps only).
  const bigLp = solveLPRowGeneration(buildLp(UNCAPPED_CEILING_KVA), { batch: 40 });
  const total = x.reduce((s, v) => s + v, 0);
  if (bigLp.status === 'optimal') lastLp = { objective: total + bigLp.objective, x: x.map((v, i) => v + bigLp.x[i]) };
  const bound = lastLp ? Math.max(lastLp.objective, total) : undefined;
  if (lastLp && lastLp.objective < total) notes.push('The final linearisation estimates less than the verified total (the network is less linear here) — the gap is shown as 0.');
  if (H.loadFlows() >= budget) notes.push(`Stopped at the load-flow budget (${budget}).`);
  return {
    kind, locations: locs, hours, txLimitBothDirections: lim.txLimitBothDirections,
    allocation: locs.map((l, i) => ({ ...l, kva: x[i] })).filter(a => a.kva > 0),
    totalKva: total, trace, baselineViolations: H.baseline.violations,
    ...optResult({
      method: `Successive linear programming (${trace.length} steps)`, certificate: 'lp-bound',
      objective: total, bound, gapPct: bound ? Math.max(0, (bound - total) / bound * 100) : undefined,
      evaluations: H.loadFlows(), ms: elapsedMs(t0), solution: x, verified: true, notes
    })
  };
}

/**
 * Fair-share hosting: the largest uniform size every location can host at once.
 * @param {Design} design0
 * @param {{ kind?: 'pv' | 'bess', locations?: HostingLocation[], hours?: number[], txLimitBothDirections?: boolean, cap?: number, resolution?: number } & ProgressHooks} [opts]
 */
export function hostingFairShare(design0, opts = {}) {
  const t0 = nowMs();
  const kind = opts.kind === 'bess' ? 'bess' : 'pv';
  const locs = opts.locations && opts.locations.length ? opts.locations : allLocations(design0);
  const H = hostingContext(design0, kind, opts.txLimitBothDirections, opts.hours);
  const res = opts.resolution ?? 0.001;
  const cap = opts.cap ?? 100;
  const floorRes = (/** @type {number} */ v) => Math.floor(v / res + 1e-9) * res;
  let calls = 0;
  /** @type {any} */
  let limit = null;
  const test = (/** @type {number} */ s) => {
    calls++;
    if (opts.onProgress) opts.onProgress({ stage: 'Fair share: testing a uniform size', done: Math.min(calls, 30), total: 30 });
    const f = H.verify(locs, locs.map(() => s));
    if (f) limit = f;
    return !f;
  };
  // Bisection to `res`, never reporting an untested size (O3.1): lo always passed, hi always failed.
  const bisect = (/** @type {number} */ lo, /** @type {number} */ hi) => { while (hi - lo > res) { const mid = (lo + hi) / 2; if (test(mid)) lo = mid; else hi = mid; } return lo; };
  let s = test(cap) ? cap : bisect(0, cap);
  /** @type {{ firstBoundaryKva: number, probePassKva: number, kva: number } | undefined} */
  let nonMonotonic;
  if (s < cap) {
    let upper = cap;
    for (let j = 7; j >= 1; j--) {
      const p = s + (cap - s) * j / 8;
      if (test(p)) { const found = bisect(p, upper); nonMonotonic = { firstBoundaryKva: s, probePassKva: p, kva: found }; s = found; break; }
      upper = p;
    }
  }
  s = floorRes(s);
  return {
    kind, locations: locs, hours: H.hours, sizeKva: s, totalKva: s * locs.length, limit, nonMonotonic, baselineViolations: H.baseline.violations,
    ...optResult({ method: 'Uniform-size bisection with probe', certificate: nonMonotonic ? 'heuristic' : 'exact', objective: s, evaluations: H.loadFlows(), ms: elapsedMs(t0), solution: s, verified: true,
      notes: nonMonotonic ? ['Feasibility is not monotonic in the uniform size here: a larger size passed after a smaller one failed.'] : ['Exact for the uniform-size question, to the stated resolution, assuming feasibility is one interval from 0 (checked by the probe).'] })
  };
}
