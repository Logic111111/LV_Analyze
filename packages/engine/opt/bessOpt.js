// @ts-check
// BESS sizing for losses (O4): the battery sizes x (kVA per candidate location, 0 ≤ x ≤ cap) that
// minimise the network's daily energy loss, subject to no new or worsened violation in any hour
// of the day (24 h scans, every chosen year).
//
// The legacy BESS queue maximises how much battery fits, ranked by the loss saving of a 1 kVA
// probe — the slope of the loss at zero size. That slope says nothing about what happens at
// 15 kVA: a battery that charges at midday and discharges in the evening first flattens the
// feeder's current (less I²R) and then, past the size where it reverses the flow, adds loss
// again. On the fixture the legacy allocation raises the daily loss from 13.29 to 25.47 kWh. This
// optimiser minimises the loss directly:
//   - Objective: daily loss f(x) (line + transformer + earth, 24 h at the first year), each
//     evaluation one full 24 h scan, cached by x.
//   - Gradient: forward differences (0.5 kVA steps; backward at a cap).
//   - Projected gradient with a trust region Δ (∞-norm, start 10 kVA): x' = x − Δ·g/max|g|,
//     clipped to [0, cap] and floored to 0.05 kVA. Accepted only if it passed full load flows at
//     every hour and year (no new or worsened violation, judged with the legacy BESS relevance
//     filter; converged) and lowered the loss — then Δ grows ×1.5 (to 40); otherwise Δ halves,
//     which is the "shrink the step until verified" projection onto the feasible set.
//   - Stop when Δ < 0.2 kVA, or at the evaluation budget.
//   - Multi-start (seeded): x = 0, the legacy queue allocation scaled to 25 % and 50 %, then
//     random points. x = 0 is always feasible, so the answer is never worse than no battery.
//     `restartsFoundBest` counts restarts that ended within 0.1 % of the best loss (the loss
//     surface is flat near its minimum: sizes a few tenths of a kVA apart differ by thousandths of
//     a kWh); certificate 'heuristic'.
// If the fixed charge/discharge schedule means batteries can't reduce losses at a location, its
// optimum size is (near) zero — a valid engineering answer, and the result says so. With
// SOC-scheduled units in the design their dispatch is simulated as usual; candidates themselves
// follow the fixed schedule, as in the legacy search.
import { runDailyScan, systemLossW } from '../scan.js';
import { newOrWorsenedViolation, violationKey } from '../hosting.js';
import { bessRelevantViolations, computeSystemBessHostingCapacity } from '../bess.js';
import { allLocations } from './hostingOpt.js';
import { rngFor } from './prng.js';
import { optResult, nowMs, elapsedMs } from './result.js';
/** @import { Design, ProgressHooks } from '../types.js' */
/** @typedef {import('./sensitivity.js').Location} BessLocation */

const STEP = 20;
const floorStep = (/** @type {number} */ v) => Math.floor(v * STEP + 1e-9) / STEP;

/**
 * @param {Design} design
 * @param {{ locations?: BessLocation[], caps?: number | number[], years?: number[], seed?: number, restarts?: number, budget?: number } & ProgressHooks} [opts]
 */
export function bessLossOptimal(design, opts = {}) {
  const t0 = nowMs();
  const locs = opts.locations && opts.locations.length ? opts.locations : allLocations(design);
  const n = locs.length;
  const years = opts.years && opts.years.length ? opts.years : [0];
  const restarts = Math.max(1, Math.floor(opts.restarts ?? 10));
  const budget = Math.max(10, Math.floor(opts.budget ?? 1500));
  const seed = opts.seed ?? 1;
  const progress = opts.onProgress || (() => {});
  const notes = [];

  // The legacy queue: its allocation seeds two starts, and its independent limits are the
  // default caps (the most each location could take on its own).
  progress({ stage: 'Legacy BESS queue (starting points)', done: 0, total: 1 });
  const legacy = computeSystemBessHostingCapacity(design);
  const legacyAt = new Map(legacy.results.map(r => [`${r.pole}|${r.phase}`, r]));
  const caps = locs.map((l, i) => {
    const c = Array.isArray(opts.caps) ? opts.caps[i] : opts.caps;
    if (Number.isFinite(c)) return Math.max(0, /** @type {number} */ (c));
    const r = legacyAt.get(`${l.pole}|${l.phase}`);
    return r ? r.independentKva : 0;
  });

  // Baseline violations per year and hour, filtered as the legacy BESS search filters them.
  const baseline = years.map(year => runDailyScan(design, year).map(res => new Map(bessRelevantViolations(design, res.hour, res.violations).map(v => [violationKey(v), v]))));
  const baseLoss = runDailyScan(design, years[0]).reduce((s, r) => s + systemLossW(r).totalLossW / 1000, 0);

  /** @type {Map<string, { loss: number, feasible: boolean }>} */
  const cache = new Map();
  let evaluations = 0;
  /** @param {number[]} x */
  const evaluate = (x) => {
    const key = x.join(',');
    const hit = cache.get(key);
    if (hit) return hit;
    evaluations++;
    const extraBess = locs.map((l, i) => ({ pole: l.pole, phase: l.phase, kva: x[i] })).filter(b => b.kva > 0);
    let feasible = true, loss = 0;
    years.forEach((year, yi) => {
      runDailyScan(design, year, { extraBess }).forEach((res, h) => {
        if (yi === 0) loss += systemLossW(res).totalLossW / 1000;
        if (!feasible) return;
        if (!res.converged || newOrWorsenedViolation(bessRelevantViolations(design, res.hour, res.violations), baseline[yi][h])) feasible = false;
      });
    });
    const r = { loss, feasible };
    cache.set(key, r);
    return r;
  };
  const clip = (/** @type {number[]} */ x) => x.map((v, i) => Math.min(caps[i], Math.max(0, floorStep(v))));
  /** Halve a start until it is feasible (x = 0 always is). @param {number[]} x */
  const repair = (x) => { let y = clip(x); for (let k = 0; k < 12 && !evaluate(y).feasible; k++) y = clip(y.map(v => v / 2)); return evaluate(y).feasible ? y : Array(n).fill(0); };

  const rand = rngFor(seed);
  const legacyX = locs.map(l => { const r = legacyAt.get(`${l.pole}|${l.phase}`); return r ? r.achievableKva : 0; });
  /** @type {{ label: string, x: number[] }[]} */
  const starts = [
    { label: 'zero', x: Array(n).fill(0) },
    { label: 'legacy × 25 %', x: legacyX.map(v => v * 0.25) },
    { label: 'legacy × 50 %', x: legacyX.map(v => v * 0.5) }
  ];
  while (starts.length < restarts) starts.push({ label: 'random', x: caps.map(c => rand() * c * 0.3) });

  const runs = [];
  for (let r = 0; r < restarts && evaluations < budget; r++) {
    let x = repair(starts[r].x), fx = evaluate(x).loss, delta = 10;
    const h = 0.5;
    while (delta >= 0.2 && evaluations < budget) {
      progress({ stage: `Restart ${r + 1} of ${restarts} (${starts[r].label})`, done: Math.min(evaluations, budget), total: budget });
      // Forward-difference gradient (backward at a cap).
      const g = x.map((v, i) => {
        if (caps[i] <= 0) return 0;
        const up = v + h <= caps[i];
        const y = x.slice(); y[i] = up ? v + h : Math.max(0, v - h);
        if (y[i] === v) return 0;
        const fy = evaluate(y).loss;
        return up ? (fy - fx) / h : (fx - fy) / h;
      });
      // Project: no move below 0 or above the cap.
      const d = g.map((gi, i) => ((x[i] <= 0 && gi > 0) || (x[i] >= caps[i] && gi < 0) ? 0 : -gi));
      const m = Math.max(...d.map(Math.abs));
      if (!(m > 1e-9)) break;
      const cand = clip(x.map((v, i) => v + delta * d[i] / m));
      const c = evaluate(cand);
      if (c.feasible && c.loss < fx - 1e-6 && cand.some((v, i) => v !== x[i])) { x = cand; fx = c.loss; delta = Math.min(delta * 1.5, 40); }
      else delta /= 2;
    }
    runs.push({ start: starts[r].label, x, lossKwh: fx, totalKva: x.reduce((s, v) => s + v, 0) });
  }
  const best = runs.reduce((b, c) => (c.lossKwh < b.lossKwh - 1e-9 ? c : b));
  const found = runs.filter(c => c.lossKwh <= best.lossKwh * 1.001 + 1e-9).length;
  const zeroish = best.x.filter(v => v < 0.5).length;
  if (zeroish >= n / 2) notes.push(`With this charge/discharge schedule, batteries at ${zeroish} of ${n} locations can't reduce losses: their optimal size is (near) zero. That is a valid result — the schedule, not the size, limits them.`);
  if (evaluations >= budget) notes.push(`Stopped at the evaluation budget (${budget} 24 h scans).`);
  notes.push('The legacy ranking by "marginal loss saving at zero size (local slope)" is only the gradient at x = 0 here — the first step of the search, not its answer.');
  return {
    locations: locs, caps, years,
    allocation: locs.map((l, i) => ({ ...l, kva: best.x[i] })).filter(a => a.kva > 0),
    totalKva: best.totalKva, lossKwh: best.lossKwh, baselineLossKwh: baseLoss,
    legacy: { totalKva: legacy.totalKva, lossKwh: legacy.withBessLossKwh.totalKwh },
    runs: runs.map(r => ({ start: r.start, lossKwh: r.lossKwh, totalKva: r.totalKva })),
    ...optResult({
      method: `Projected gradient, ${runs.length} seeded starts`, certificate: 'heuristic', objective: best.lossKwh,
      restartsFoundBest: { found, of: runs.length }, evaluations, ms: elapsedMs(t0), solution: best.x, verified: true, notes
    })
  };
}
