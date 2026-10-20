// @ts-check
// Reconductoring advisor: which spans to restring with a lower-resistance conductor, and what it
// buys. Candidates come from the design's own conductor library (built-ins plus whatever sizes the
// user has entered with their datasheet R, X, neutral and rating):
//   (a) single span: each span upgraded to each library conductor with a lower phase R;
//   (b) trunk: for each pole that violates in the baseline, the first k spans of its path from the
//       transformer (k = 1 … path length) upgraded together to each conductor — spans already at
//       or below that conductor's R are left alone. Voltage drop accumulates from the transformer
//       outwards, so the upstream spans (carrying the most current) usually matter most.
// Every candidate is an exact 24 h scan per checked year — never an estimate.
import { conductorCodes, conductorParams, getConductor, isTransformerId, poleById } from '../model.js';
import { runHours, systemLossW, DAILY_HOURS } from '../scan.js';
/** @import { Design } from '../types.js' */

/** @typedef {{ pole: string, from: string, to: string, spanM: number }} SpanChange */

// Missing or invalid electrical data that would make a conductor unusable in the solver.
/** @param {any} c @returns {string[]} */
export function conductorIssues(c) {
  const issues = [];
  const pos = (v) => v !== null && v !== '' && v !== undefined && Number.isFinite(Number(v)) && Number(v) > 0;
  const nonNeg = (v) => v !== null && v !== '' && v !== undefined && Number.isFinite(Number(v)) && Number(v) >= 0;
  if (!c) return ['not in the library'];
  if (!pos(c.R)) issues.push('phase R');
  if (!nonNeg(c.X) && !pos(c.Z)) issues.push('phase X (or |Z|)');
  if (!pos(c.Rn) && !pos(c.neutralScale)) issues.push('neutral R (or neutral scale)');
  if (!pos(c.I)) issues.push('current rating');
  return issues;
}

/** Library codes whose electrical data is complete, built-ins first. @param {Design} design */
export function usableConductorCodes(design) {
  return conductorCodes(design).filter(code => conductorIssues(getConductor(design, code)).length === 0);
}

/** Cost per metre of a library conductor, or null if not entered. @param {Design} design @param {string} code */
export function conductorCostPerM(design, code) {
  const c = /** @type {any} */ (getConductor(design, code));
  return c.costPerM !== null && c.costPerM !== '' && c.costPerM !== undefined && Number.isFinite(Number(c.costPerM)) ? Number(c.costPerM) : null;
}

/** Applies span conductor changes; pure. @param {Design} design @param {{ pole: string, to: string }[]} changes @returns {Design} */
export function applyReconductor(design, changes) {
  const to = new Map(changes.map(c => [c.pole, c.to]));
  return { ...design, poles: design.poles.map(p => (to.has(p.id) ? { ...p, cond: to.get(p.id) } : p)) };
}

/**
 * Violation counts (voltage and thermal, per year), year-0 loss and the poles that violate.
 * @param {Design} design @param {number[]} years @param {number[]} hours @param {() => void} [tick]
 */
function evaluate(design, years, hours, tick) {
  /** @type {Record<number, number>} */ const voltageByYear = {};
  /** @type {Record<number, number>} */ const thermalByYear = {};
  const violatingPoles = new Set();
  let kwhYear0 = 0, converged = true;
  years.forEach((year, i) => {
    let v = 0, t = 0;
    runHours(design, hours, { year, loadMult: 1, solarMult: 1 }, { onProgress: tick }).forEach(res => {
      if (!res.converged) converged = false;
      res.violations.forEach(x => {
        if (x.type === 'undervoltage' || x.type === 'overvoltage') { v++; violatingPoles.add(x.pole); }
        else if (x.type === 'thermal') { t++; violatingPoles.add(x.pole); }
      });
      if (i === 0) kwhYear0 += systemLossW(res).totalLossW / 1000;
    });
    voltageByYear[year] = v; thermalByYear[year] = t;
  });
  /** @type {Record<number, number>} */ const violationsByYear = {};
  years.forEach(y => { violationsByYear[y] = voltageByYear[y] + thermalByYear[y]; });
  return { voltageByYear, thermalByYear, violationsByYear, totalViolations: years.reduce((s, y) => s + violationsByYear[y], 0), kwhYear0, violatingPoles: [...violatingPoles], converged };
}

/**
 * @param {Design} design
 * @param {{ years?: number[], hours?: number[], maxCandidates?: number, onProgress?: (p: import('../types.js').Progress) => void }} [opts]
 */
export function reconductorAdvisor(design, opts = {}) {
  const years = [...new Set(opts.years ?? [0])].sort((a, b) => a - b);
  const hours = opts.hours ?? DAILY_HOURS;
  const maxCandidates = opts.maxCandidates ?? 200;
  const progress = opts.onProgress || (() => {});
  const codes = usableConductorCodes(design);
  const R = (/** @type {string} */ code) => conductorParams(design, code).R;

  let ticks = 0;
  const baseSteps = years.length * hours.length;
  const baseline = evaluate(design, years, hours, () => progress({ stage: '1/2 Baseline scan', done: ++ticks, total: baseSteps }));

  // Candidate change sets, deduplicated (a trunk of one span is the same as a single-span change).
  /** @type {Map<string, { kind: 'span' | 'trunk', changes: SpanChange[] }>} */
  const byKey = new Map();
  /** @param {'span' | 'trunk'} kind @param {SpanChange[]} changes */
  const add = (kind, changes) => {
    if (!changes.length) return;
    const key = changes.map(c => `${c.pole}:${c.to}`).sort().join(',');
    if (!byKey.has(key)) byKey.set(key, { kind, changes });
  };
  const change = (/** @type {string} */ poleId, /** @type {string} */ to) => {
    const p = poleById(design, poleId);
    return { pole: poleId, from: p.cond, to, spanM: Number(p.spanM) || 0 };
  };
  design.poles.forEach(p => {
    codes.forEach(code => { if (R(code) < R(p.cond)) add('span', [change(p.id, code)]); });
  });
  baseline.violatingPoles.filter(id => poleById(design, id)).forEach(id => {
    const path = [];
    for (let cur = id; !isTransformerId(design, cur); cur = poleById(design, cur).parent) path.unshift(cur);
    for (let k = 1; k <= path.length; k++) {
      codes.forEach(code => add('trunk', path.slice(0, k).filter(pid => R(code) < R(poleById(design, pid).cond)).map(pid => change(pid, code))));
    }
  });
  const all = [...byKey.values()];
  const truncated = all.length > maxCandidates;
  const pool = all.slice(0, maxCandidates);

  ticks = 0;
  const candSteps = pool.length * years.length * hours.length;
  const candidates = pool.map(({ kind, changes }) => {
    const m = evaluate(applyReconductor(design, changes), years, hours, () => progress({ stage: '2/2 Scanning candidates', done: ++ticks, total: candSteps }));
    const costs = changes.map(c => conductorCostPerM(design, c.to));
    const capex = costs.every(c => c !== null) ? changes.reduce((s, c, i) => s + c.spanM * costs[i], 0) : null;
    const violationsRemoved = baseline.totalViolations - m.totalViolations;
    return {
      kind, changes, lengthM: changes.reduce((s, c) => s + c.spanM, 0),
      ...m,
      kwhSavedPerDay: baseline.kwhYear0 - m.kwhYear0,
      violationsRemoved,
      capex,
      lkrPerViolationRemoved: capex !== null && violationsRemoved > 0 ? capex / violationsRemoved : null
    };
  });

  // Ranking: fewest violations first. Within a tier, by capex then loss when every candidate in it
  // has a cost; if any cost is missing, by loss alone (and the page shows "cost unknown").
  const tiers = new Map();
  candidates.forEach(c => { const t = tiers.get(c.totalViolations) || []; t.push(c); tiers.set(c.totalViolations, t); });
  const ranked = [...tiers.keys()].sort((a, b) => a - b).flatMap(k => {
    const tier = tiers.get(k);
    const allCosted = tier.every(c => c.capex !== null);
    return tier.sort((a, b) => (allCosted ? a.capex - b.capex || a.kwhYear0 - b.kwhYear0 : a.kwhYear0 - b.kwhYear0));
  });

  return { years, hours: hours.length, baseline, candidates: ranked, candidateCount: all.length, truncated, conductorsConsidered: codes };
}

/** One-line description of a change set, e.g. "P3 50ABC→70ABC (60 m)". @param {SpanChange[]} changes */
export function describeReconductor(changes) {
  return changes.map(c => `${c.pole} ${c.from}→${c.to} (${c.spanM} m)`).join(', ');
}

// Re-exported for the Setup page hint: IEC 60228 Table 2, class 2 (stranded) aluminium conductors,
// maximum DC resistance at 20 °C, Ω/km. Reference values for R only — X, the neutral and the
// current rating depend on the cable construction and must come from its datasheet.
export const IEC60228_AL_R20_OHM_PER_KM = Object.freeze({
  16: 1.91, 25: 1.20, 35: 0.868, 50: 0.641, 70: 0.443, 95: 0.320, 120: 0.253, 150: 0.206, 185: 0.164, 240: 0.125
});
