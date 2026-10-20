// @ts-check
// BESS hosting capacity (charge and discharge windows) and its loss-reduction priority queue.
import { PHASES } from './complex.js';
import { runSnapshot } from './solver.js';
import { rangeHours, bessMultiplierAt } from './loads.js';
import { UNCAPPED_CEILING_KVA, searchMaxKva, hostingBaseline, newOrWorsenedViolation } from './hosting.js';
import { systemLossW, dailyEnergyLossKwh } from './scan.js';
/** @import { Design, BessConnection, Violation } from './types.js' */
/** @import { HostingRow, HostingBaseline } from './hosting.js' */

/* ============================================================
   BESS HOSTING CAPACITY
============================================================ */
// BESS stresses the network in both directions — charging pulls voltage down and loads the
// transformer like any load, discharging pushes voltage up and reverse-flows it like PV — so
// candidates are tested across the union of both configured windows rather than one fixed
// shoulder-hour list.
/** @param {Design} design @returns {number[]} */
function bessTestHours(design) {
  return [...rangeHours(design.bessChargeStartHour, design.bessChargeEndHour), ...rangeHours(design.bessDischargeStartHour, design.bessDischargeEndHour)];
}

// At any hour inside the (global) charge window, every BESS unit in the network — committed,
// candidate, and real — is charging, so the only way voltage moves is down: charging can create
// or worsen undervoltage/thermal/transformer-import loading, but it physically cannot cause
// overvoltage, only relieve it (that's the whole point of scheduling charging over the midday
// solar window — it's meant to soak up the overvoltage high solar generation causes). Symmetrically,
// every BESS unit is discharging inside the discharge window, so it can create or worsen
// overvoltage/thermal, but cannot cause undervoltage — it can only relieve it (that's the point of
// scheduling discharge over the evening peak). So a hosting candidate should never be rejected for
// an overvoltage seen at a charge hour, or an undervoltage seen at a discharge hour — that
// violation is coming from solar/load that exists with or without this BESS, and the BESS is
// helping (or at worst is neutral to) it, not causing it.
/** @param {Design} design @param {number} hour @param {Violation[]} violations @returns {Violation[]} */
export function bessRelevantViolations(design, hour, violations) {
  const mult = bessMultiplierAt(design, hour);
  if (mult < 0) return violations.filter(v => v.type !== 'overvoltage');
  if (mult > 0) return violations.filter(v => v.type !== 'undervoltage');
  return violations;
}

// BESS hosting baseline: the design's own violations across the charge and discharge windows,
// filtered the same way candidates are (see bessRelevantViolations and the baseline note in
// hosting.js) — what the BESS Hosting page lists.
/** @param {Design} design @returns {HostingBaseline} */
export function bessHostingBaseline(design) {
  return hostingBaseline(design, bessTestHours(design), (h, vs) => bessRelevantViolations(design, h, vs));
}

// Largest single-phase BESS (kVA) addable at pole/phase — on top of any `committed` additions
// already locked in elsewhere — without creating or worsening a violation the BESS could actually
// cause, across the charge and discharge windows (a candidate is judged only in the direction it
// can affect at each hour — see bessRelevantViolations — and relative to the baseline).
/** @param {Design} design @param {string} pole @param {import('./types.js').Phase} phase @param {number} hi @param {BessConnection[]} committed @param {HostingBaseline} baseline @returns {number} kVA */
function findMaxBess(design, pole, phase, hi, committed, baseline) {
  const testHours = bessTestHours(design);
  return searchMaxKva(kva => {
    for (const h of testHours) {
      const res = runSnapshot(design, { year: 0, hour: h, loadMult: 1, solarMult: 1, extraBess: [...committed, { pole, phase, kva }] });
      if (newOrWorsenedViolation(bessRelevantViolations(design, h, res.violations), baseline.byHour.get(h))) return false;
    }
    return true;
  }, hi);
}

/** @param {Design} design @param {number} cap @param {HostingBaseline} baseline @returns {HostingRow[]} */
function independentBess(design, cap, baseline) {
  const results = [];
  design.poles.forEach(p => {
    PHASES.forEach(phase => {
      const best = findMaxBess(design, p.id, phase, cap, [], baseline);
      if (best > 0.05) results.push({ pole: p.id, phase, kva: best });
    });
  });
  results.sort((a, b) => b.kva - a.kva);
  return results;
}

/** @param {Design} design @param {number} [capOverride] @returns {HostingRow[]} */
export function computeBessHostingCapacity(design, capOverride) {
  const cap = capOverride != null ? capOverride : design.maxbess;
  return independentBess(design, cap, bessHostingBaseline(design));
}

// Average reduction in total system loss (line + transformer) a small 1 kVA BESS addition at
// pole/phase produces, across the charge+discharge test hours, on top of `committed` — positive
// means adding BESS here reduces network loss (e.g. peak-shaving a heavily loaded feeder tail).
/** @param {Design} design @param {string} pole @param {import('./types.js').Phase} phase @param {BessConnection[]} committed @returns {number} W */
function lossImpactScore(design, pole, phase, committed) {
  const testHours = bessTestHours(design);
  const probeKva = 1;
  let deltaSum = 0;
  testHours.forEach(h => {
    const base = runSnapshot(design, { year: 0, hour: h, loadMult: 1, solarMult: 1, extraBess: committed });
    const withProbe = runSnapshot(design, { year: 0, hour: h, loadMult: 1, solarMult: 1, extraBess: [...committed, { pole, phase, kva: probeKva }] });
    deltaSum += systemLossW(base).totalLossW - systemLossW(withProbe).totalLossW;
  });
  return deltaSum / testHours.length;
}

// System-wide BESS hosting capacity: unlike the PV queue (which fills by raw headroom first),
// this queue is ordered by loss-reduction impact — locations that cut network loss the most are
// committed first — then walked exactly like the PV queue (each candidate tested with every
// higher-priority addition already locked in) to get the true simultaneous maximum. The Setup
// page's per-connection BESS cap is ignored here — this reports the physical ceiling.
/** @param {Design} design */
export function computeSystemBessHostingCapacity(design) {
  const baseline = bessHostingBaseline(design);
  const independent = independentBess(design, UNCAPPED_CEILING_KVA, baseline);
  const scored = independent.map(cand => ({ ...cand, lossScore: lossImpactScore(design, cand.pole, cand.phase, []) }));
  scored.sort((a, b) => b.lossScore - a.lossScore || b.kva - a.kva);

  const committed = [];
  const results = scored.map(cand => {
    const best = findMaxBess(design, cand.pole, cand.phase, cand.kva, committed, baseline);
    if (best > 0.05) committed.push({ pole: cand.pole, phase: cand.phase, kva: best });
    return { pole: cand.pole, phase: cand.phase, independentKva: cand.kva, lossScore: cand.lossScore, achievableKva: best };
  });
  const totalKva = results.reduce((s, r) => s + r.achievableKva, 0);

  const baselineLossKwh = dailyEnergyLossKwh(design, []);
  const withBessLossKwh = dailyEnergyLossKwh(design, committed);
  return {
    results, totalKva, baselineLossKwh, withBessLossKwh,
    lossReductionKwh: baselineLossKwh.totalKwh - withBessLossKwh.totalKwh
  };
}
