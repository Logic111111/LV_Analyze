// @ts-check
// Solar PV hosting capacity: per-location binary search, and the simultaneous (queue) version.
import { PHASES } from './complex.js';
import { runSnapshot } from './solver.js';
/** @import { Design, PvConnection } from './types.js' */
/** @typedef {{ pole: string, phase: import('./types.js').Phase, kva: number }} HostingRow */

/* ============================================================
   SOLAR HOSTING CAPACITY
============================================================ */
export const HOSTING_TEST_HOURS = [9, 10, 11, 12, 13, 14, 15];

// Binary-searches the largest single-phase PV (kVA) addable at pole/phase — on top of any
// `committed` additions already locked in elsewhere — before a voltage or thermal limit is
// hit across the solar shoulder hours. Iteration count scales with the search ceiling so
// resolution stays fine (~0.02 kVA) whether `hi` is a small policy cap or a large uncapped one.
/** @param {Design} design @param {string} pole @param {import('./types.js').Phase} phase @param {number} hi @param {PvConnection[]} committed @returns {number} kVA */
function findMaxPV(design, pole, phase, hi, committed) {
  let lo = 0, best = 0;
  const iters = Math.max(7, Math.ceil(Math.log2(Math.max(hi, 0.01) / 0.02)) + 1);
  for (let iter = 0; iter < iters; iter++) {
    const mid = (lo + hi) / 2;
    let feasible = true;
    for (const h of HOSTING_TEST_HOURS) {
      const res = runSnapshot(design, { year: 0, hour: h, loadMult: 1, solarMult: 1, extraPV: [...committed, { pole, phase, kva: mid }] });
      if (res.violations.length > 0) { feasible = false; break; }
    }
    if (feasible) { best = mid; lo = mid; } else { hi = mid; }
  }
  return Math.round(best * 20) / 20;
}

/** @param {Design} design @param {number} [capOverride] @returns {HostingRow[]} */
export function computeHostingCapacity(design, capOverride) {
  const results = [];
  const cap = capOverride != null ? capOverride : design.maxpv;
  design.poles.forEach(p => {
    PHASES.forEach(phase => {
      const best = findMaxPV(design, p.id, phase, cap, []);
      if (best > 0.05) results.push({ pole: p.id, phase, kva: best });
    });
  });
  results.sort((a, b) => b.kva - a.kva);
  return results;
}

// Generous ceiling used only to discover each location's true, policy-unconstrained
// voltage/thermal limit for computeSystemHostingCapacity — comfortably above anything a real
// single-phase LV connection could reach, so the search always bottoms out on an actual
// network limit (voltage rise or conductor thermal rating) rather than this number.
export const UNCAPPED_CEILING_KVA = 2000;

// System-wide hosting capacity: processes candidate pole/phase locations in the same
// best-first order as computeHostingCapacity, but — like a real interconnection queue —
// tests each candidate's headroom with every previously accepted addition already locked
// in place. This captures the interaction between simultaneous PV additions (compounding
// voltage rise, shared thermal headroom) that the independent per-location scan ignores,
// so the resulting total is the true maximum that can be added to the design all at once,
// and per-location amounts often come out lower than the independent estimate. The Setup
// page's per-connection PV cap is deliberately ignored here — this reports the physical
// (voltage/thermal) ceiling, not a policy-limited one.
/** @param {Design} design */
export function computeSystemHostingCapacity(design) {
  const independent = computeHostingCapacity(design, UNCAPPED_CEILING_KVA);
  const committed = [];
  const results = independent.map(cand => {
    const best = findMaxPV(design, cand.pole, cand.phase, cand.kva, committed);
    if (best > 0.05) committed.push({ pole: cand.pole, phase: cand.phase, kva: best });
    return { pole: cand.pole, phase: cand.phase, independentKva: cand.kva, achievableKva: best };
  });
  const totalKva = results.reduce((s, r) => s + r.achievableKva, 0);
  return { results, totalKva };
}
