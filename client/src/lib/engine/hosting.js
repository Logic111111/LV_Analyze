// @ts-check
// Solar PV hosting capacity: per-location binary search, and the simultaneous (queue) version.
import { PHASES } from './complex.js';
import { runSnapshot, warmStartFrom, topologyOf } from './solver.js';
import { connectionIndex } from './loads.js';
/** @import { Design, PvConnection, Violation } from './types.js' */
/**
 * What stopped a hosting search: the ceiling itself passed ('cap'), a new or worsened violation
 * ('violation' — `limitDetail` is that violation plus its hour), or the load flow failing to
 * converge ('nonConvergence' — `limitDetail.hour`). Reported for the tightest failing size found.
 * @typedef {'cap' | 'violation' | 'nonConvergence'} HostingLimit
 */
/** @typedef {{ hour: number } & Partial<Violation>} HostingLimitDetail */
/** @typedef {{ pole: string, phase: import('./types.js').Phase, kva: number, limit: HostingLimit, limitDetail: HostingLimitDetail | null }} HostingRow */
/** @typedef {{ reason: 'violation' | 'nonConvergence', detail: HostingLimitDetail }} HostingFailure */

/* ============================================================
   SOLAR HOSTING CAPACITY
============================================================ */
export const HOSTING_TEST_HOURS = [9, 10, 11, 12, 13, 14, 15];

// Hosting results are reported in 0.05 kVA steps.
const STEPS_PER_KVA = 20;
/** @param {number} kva */
const floorToStep = (kva) => Math.floor(kva * STEPS_PER_KVA + 1e-9) / STEPS_PER_KVA;

/**
 * Largest size in [0, cap], on the 0.05 kVA grid, that passes `test` — shared by the PV and BESS
 * searches. Assumes feasibility is monotonic in size (a bigger injection only moves voltages
 * further and loads spans harder), which is what makes a binary search valid at all.
 *
 * Every size it reports has passed `test` (full load flows) or lies below one that has:
 *   1. The cap itself is tested first. If it passes, the answer is the cap — a policy cap is
 *      reported exactly, and the binary search is skipped.
 *   2. Otherwise the original binary search runs (same midpoints as before; iteration count
 *      scales with the ceiling so resolution stays ~0.02 kVA whether `cap` is a small policy cap
 *      or the large uncapped ceiling), and the best passing size is floored to the grid.
 *      (Rounding to the *nearest* step — the old behaviour — could report the step above the
 *      best tested size, which in practice often failed.)
 *   3. The next grid step up is tried once, and reported only if it passes — so the result is
 *      the largest grid step that passes, not one step short of it.
 * @param {(kva: number) => boolean} test
 * @param {number} cap
 * @returns {number} kVA
 */
export function searchMaxKva(test, cap) {
  if (!(cap > 0)) return 0;
  if (test(cap)) return floorToStep(cap);
  let lo = 0, hi = cap, best = 0;
  const iters = Math.max(7, Math.ceil(Math.log2(Math.max(cap, 0.01) / 0.02)) + 1);
  for (let iter = 0; iter < iters; iter++) {
    const mid = (lo + hi) / 2;
    if (test(mid)) { best = mid; lo = mid; } else { hi = mid; }
  }
  const kva = floorToStep(best);
  // `hi` is now the smallest size known to fail; a step at or above it can't pass.
  const next = (Math.round(kva * STEPS_PER_KVA) + 1) / STEPS_PER_KVA;
  if (next < hi && test(next)) return next;
  return kva;
}

/**
 * searchMaxKva with a per-size `check` that says *why* a size fails (null = it passes), returning
 * the size and what limited it. The most recent failure is always the tightest bound — the
 * bisection only ever lowers its upper bound on a failure, and the final one-step-up probe sits
 * below that bound — so it's the one reported.
 * @param {(kva: number) => HostingFailure | null} check
 * @param {number} cap
 * @returns {{ kva: number, limit: HostingLimit, limitDetail: HostingLimitDetail | null }}
 */
export function searchWithLimit(check, cap) {
  /** @type {HostingFailure | null} */
  let last = null;
  const kva = searchMaxKva(size => {
    const f = check(size);
    if (f) { last = f; return false; }
    return true;
  }, cap);
  return { kva, limit: last ? last.reason : 'cap', limitDetail: last ? last.detail : null };
}

/* ------------------------------------------------------------
   Baseline-relative feasibility
------------------------------------------------------------ */
// A hosting candidate is judged against the design *as it stands* at the same hour, not against
// a clean sheet. Otherwise a single pre-existing violation anywhere (say an undervoltage at the
// end of a long feeder at midday) makes every candidate everywhere "infeasible" and hosting
// reports zero across the board — even for PV that would relieve that very violation. A
// candidate fails only if, at some test hour, it
//   - creates a violation that wasn't there before (a new pole + phase + type), or
//   - makes a pre-existing one worse by more than WORSEN_TOLERANCE (0.01 V for voltage,
//     0.01 percentage points for thermal and transformer loading).
// The baseline is always the original design with no hosting additions — including inside the
// simultaneous (queue) searches — so the tolerance can't creep as additions accumulate.
export const WORSEN_TOLERANCE = 0.01;

/** Identity of a violation for baseline comparison: where and what, not how bad. @param {Violation} v */
export function violationKey(v) { return `${v.pole}|${v.phase}|${v.type}`; }

/**
 * @typedef {object} HostingBaseline
 * @property {Map<number, Map<string, Violation>>} byHour Baseline violations at each test hour, by violationKey.
 * @property {(Violation & { hour: number })[]} violations Flat list, for the pages' banner.
 * @property {number[]} nonConvergedHours Test hours where the design itself didn't converge.
 * @property {Map<number, import('./solver.js').InitialV | null>} startByHour Each hour's baseline
 *   solution, used to warm-start the search's first evaluation at that hour.
 * @property {{ index: import('./loads.js').ConnectionIndex, topo: ReturnType<typeof topologyOf> }} ctx
 *   The design's connection index and topology, built once and shared by every search evaluation
 *   (candidates and committed additions arrive as extraPV/extraBess, never in the design itself).
 */

/**
 * Baseline violations at each of `hours`, with `relevant` applied (identity for PV; the BESS
 * search passes its charge/discharge filter).
 * @param {Design} design @param {number[]} hours
 * @param {(hour: number, vs: Violation[]) => Violation[]} [relevant]
 * @returns {HostingBaseline}
 */
export function hostingBaseline(design, hours, relevant = (_h, vs) => vs) {
  const byHour = new Map();
  /** @type {(Violation & { hour: number })[]} */
  const violations = [];
  /** @type {number[]} */
  const nonConvergedHours = [];
  const startByHour = new Map();
  const ctx = { index: connectionIndex(design), topo: topologyOf(design) };
  hours.forEach(hour => {
    const res = runSnapshot(design, { year: 0, hour, loadMult: 1, solarMult: 1 }, ctx);
    if (!res.converged) nonConvergedHours.push(hour);
    startByHour.set(hour, warmStartFrom(res));
    const vs = relevant(hour, res.violations);
    byHour.set(hour, new Map(vs.map(v => [violationKey(v), v])));
    vs.forEach(v => violations.push({ hour, ...v }));
  });
  return { byHour, violations, nonConvergedHours, startByHour, ctx };
}

/**
 * The first violation in `violations` that is new relative to `baselineAtHour`, or more than
 * WORSEN_TOLERANCE worse than it was — or null if the candidate is acceptable at this hour.
 * "Worse" is lower for undervoltage, higher for overvoltage / thermal / transformer overload.
 * @param {Violation[]} violations @param {Map<string, Violation>} baselineAtHour
 * @returns {Violation | null}
 */
export function newOrWorsenedViolation(violations, baselineAtHour) {
  for (const v of violations) {
    const b = baselineAtHour.get(violationKey(v));
    if (!b) return v;
    const worse = v.type === 'undervoltage' ? v.value < b.value - WORSEN_TOLERANCE : v.value > b.value + WORSEN_TOLERANCE;
    if (worse) return v;
  }
  return null;
}

/** PV hosting baseline (the solar shoulder hours) — what the Hosting page lists. @param {Design} design */
export function pvHostingBaseline(design) { return hostingBaseline(design, HOSTING_TEST_HOURS); }

// Largest single-phase PV (kVA) addable at pole/phase — on top of any `committed` additions
// already locked in elsewhere — without creating or worsening a voltage or thermal violation
// across the solar shoulder hours (see searchMaxKva for how the search reports only tested sizes,
// and the baseline note above for what "worsening" means). A size whose load flow doesn't converge
// at any test hour fails too: an unconverged result's voltages can't be trusted either way (and a
// diverging solve can show no violations at all), so it must never count as a pass.
//
// Each evaluation is warm-started (see runSnapshot) from the last converged solution at the same
// hour — the baseline's to begin with, then the previous size tried — since consecutive sizes
// differ only in one injection. Measured: ~37 % less time on a 50-pole feeder, every hosting
// golden unchanged.
/** @param {Design} design @param {string} pole @param {import('./types.js').Phase} phase @param {number} hi @param {PvConnection[]} committed @param {HostingBaseline} baseline */
function findMaxPV(design, pole, phase, hi, committed, baseline) {
  const warm = new Map(baseline.startByHour);
  return searchWithLimit(kva => {
    for (const h of HOSTING_TEST_HOURS) {
      const res = runSnapshot(design, { year: 0, hour: h, loadMult: 1, solarMult: 1, extraPV: [...committed, { pole, phase, kva }] }, { ...baseline.ctx, initialV: warm.get(h) || null });
      if (!res.converged) return { reason: 'nonConvergence', detail: { hour: h } };
      warm.set(h, warmStartFrom(res));
      const v = newOrWorsenedViolation(res.violations, baseline.byHour.get(h));
      if (v) return { reason: 'violation', detail: { hour: h, ...v } };
    }
    return null;
  }, hi);
}

/** @param {Design} design @param {number} cap @param {HostingBaseline} baseline @returns {HostingRow[]} */
function independentPV(design, cap, baseline) {
  const results = [];
  design.poles.forEach(p => {
    PHASES.forEach(phase => {
      const best = findMaxPV(design, p.id, phase, cap, [], baseline);
      if (best.kva > 0.05) results.push({ pole: p.id, phase, kva: best.kva, limit: best.limit, limitDetail: best.limitDetail });
    });
  });
  results.sort((a, b) => b.kva - a.kva);
  return results;
}

/** @param {Design} design @param {number} [capOverride] @returns {HostingRow[]} */
export function computeHostingCapacity(design, capOverride) {
  const cap = capOverride != null ? capOverride : design.maxpv;
  return independentPV(design, cap, pvHostingBaseline(design));
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
  const baseline = pvHostingBaseline(design);
  const independent = independentPV(design, UNCAPPED_CEILING_KVA, baseline);
  const committed = [];
  const results = independent.map(cand => {
    const best = findMaxPV(design, cand.pole, cand.phase, cand.kva, committed, baseline);
    if (best.kva > 0.05) committed.push({ pole: cand.pole, phase: cand.phase, kva: best.kva });
    return { pole: cand.pole, phase: cand.phase, independentKva: cand.kva, achievableKva: best.kva, limit: best.limit, limitDetail: best.limitDetail };
  });
  const totalKva = results.reduce((s, r) => s + r.achievableKva, 0);
  return { results, totalKva };
}
