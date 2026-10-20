// @ts-check
// Scenario manager (P5.4). A scenario is a named set of overrides on the current design:
//   { id, name, year, loadMult, solarMult, taps: { [txId]: tap }, standardsProfileId, patch, note }
// `patch` holds the items a proposal changed, by id, per collection (transformers, poles, loads,
// pv, bess, openPoints): { upsert: [...items], remove: [...ids] }. designPatch() builds it from
// "before" and "after" designs, so any advisor proposal can be kept as a scenario without the app
// knowing what kind of proposal it was.
//
// Caveat (stated in the UI): the patch keeps its own copy of each changed item, so a later edit to
// the *same* item in the base design is overridden by the scenario's copy while it is applied.
import { BUILTIN_STANDARDS_PROFILES, applyStandardsProfile } from './standards.js';
import { runDailyScan, systemLossW } from './scan.js';
import { protectionCheck } from './faults.js';
import { capexOf, optionEconomics } from './economics.js';
/** @import { Design, ProgressHooks } from './types.js' */

export const PATCH_COLLECTIONS = /** @type {const} */ (['transformers', 'poles', 'loads', 'pv', 'bess', 'openPoints']);
export const MAX_COMPARED_SCENARIOS = 4;

/** @param {Design} before @param {Design} after */
export function designPatch(before, after) {
  /** @type {Record<string, { upsert: any[], remove: string[] }>} */
  const patch = {};
  PATCH_COLLECTIONS.forEach(k => {
    const a = /** @type {any[]} */ (before[k] || []), b = /** @type {any[]} */ (after[k] || []);
    const byId = new Map(a.map(x => [x.id, JSON.stringify(x)]));
    const upsert = b.filter(x => byId.get(x.id) !== JSON.stringify(x)).map(x => ({ ...x }));
    const keep = new Set(b.map(x => x.id));
    const remove = a.filter(x => !keep.has(x.id)).map(x => x.id);
    if (upsert.length || remove.length) patch[k] = { upsert, remove };
  });
  return patch;
}

/** @param {Design} design @param {Record<string, { upsert?: any[], remove?: string[] }> | undefined} patch @returns {Design} */
export function applyPatch(design, patch) {
  if (!patch) return design;
  const out = /** @type {any} */ ({ ...design });
  PATCH_COLLECTIONS.forEach(k => {
    const p = patch[k];
    if (!p) return;
    const remove = new Set(p.remove || []);
    const up = new Map((p.upsert || []).map(x => [x.id, x]));
    const list = (out[k] || []).filter(x => !remove.has(x.id)).map(x => (up.has(x.id) ? { ...up.get(x.id) } : x));
    const present = new Set(list.map(x => x.id));
    (p.upsert || []).forEach(x => { if (!present.has(x.id)) list.push({ ...x }); });
    out[k] = list;
  });
  return out;
}

/** Short human summary of a patch, e.g. "9 loads changed, 1 span changed". @param {any} patch */
export function describePatch(patch) {
  if (!patch) return 'no network changes';
  const names = { transformers: 'transformer', poles: 'pole/span', loads: 'load', pv: 'PV', bess: 'BESS', openPoints: 'open point' };
  const parts = [];
  PATCH_COLLECTIONS.forEach(k => {
    const p = patch[k];
    if (!p) return;
    if (p.upsert.length) parts.push(`${p.upsert.length} ${names[k]}${p.upsert.length === 1 ? '' : 's'} changed/added`);
    if (p.remove.length) parts.push(`${p.remove.length} ${names[k]}${p.remove.length === 1 ? '' : 's'} removed`);
  });
  return parts.join(', ') || 'no network changes';
}

/**
 * The scenario applied: the design to solve and the operating point.
 * @param {Design} design @param {any} sc
 * @returns {{ design: Design, year: number, loadMult: number, solarMult: number }}
 */
export function applyScenario(design, sc) {
  let d = applyPatch(design, sc.patch);
  if (sc.taps && Object.keys(sc.taps).length) {
    d = { ...d, transformers: d.transformers.map(t => (sc.taps[t.id] != null && sc.taps[t.id] !== '' ? { ...t, tap: Number(sc.taps[t.id]) } : t)) };
  }
  if (sc.standardsProfileId) {
    const p = BUILTIN_STANDARDS_PROFILES.find(x => x.id === sc.standardsProfileId);
    if (p) d = /** @type {Design} */ (applyStandardsProfile(d, p));
  }
  return { design: d, year: Number(sc.year) || 0, loadMult: sc.loadMult == null ? 1 : Number(sc.loadMult), solarMult: sc.solarMult == null ? 1 : Number(sc.solarMult) };
}

/**
 * Capex of a scenario's network changes (economics.js capexOf, with the design's own costs).
 * @param {Design} base @param {Design} variant
 */
export function patchCapex(base, variant) {
  const c = capexOf(base, variant); // the applied scenario keeps the design's library and costs
  return { lkr: c.lkr, knownLkr: c.knownLkr, missing: c.missing };
}

/**
 * Side-by-side metrics of one scenario (24 h at its year and multipliers).
 * @param {Design} design @param {any} sc @param {ProgressHooks & { stage?: string }} [hooks]
 */
export function scenarioMetrics(design, sc, hooks = {}) {
  const a = applyScenario(design, sc);
  const daily = runDailyScan(a.design, a.year, { loadMult: a.loadMult, solarMult: a.solarMult, onProgress: hooks.onProgress, stage: hooks.stage });
  let violations = 0, minV = Infinity, maxV = -Infinity, worstVuf = 0, kwh = 0, txPeak = 0, converged = true;
  /** @type {any} */ let minAt = null, maxAt = null;
  daily.forEach(r => {
    if (!r.converged) converged = false;
    r.violations.forEach(v => { if (v.type === 'undervoltage' || v.type === 'overvoltage') violations++; });
    r.poleResults.forEach(p => ['A', 'B', 'C'].forEach(ph => {
      const v = p.volt[ph];
      if (v < minV) { minV = v; minAt = `${p.id} ${ph} ${String(r.hour).padStart(2, '0')}:00`; }
      if (v > maxV) { maxV = v; maxAt = `${p.id} ${ph} ${String(r.hour).padStart(2, '0')}:00`; }
    }));
    if (r.worstVuf && r.worstVuf.value > worstVuf) worstVuf = r.worstVuf.value;
    kwh += systemLossW(r).totalLossW / 1000;
    r.transformers.forEach(t => { if (t.txPct > txPeak) txPeak = t.txPct; });
  });
  const prot = protectionCheck(a.design, daily);
  const count = (s) => prot.devices.filter(d => d.overall === s).length;
  const econ = /** @type {any} */ (design).economics || {};
  const cost = Number(econ.lossCostLkrPerKwh);
  const capex = patchCapex(design, a.design);
  return {
    id: sc.id, name: sc.name, year: a.year, loadMult: a.loadMult, solarMult: a.solarMult,
    voltageViolations: violations, minV, minAt, maxV, maxAt, worstVufPct: worstVuf, lossKwhDay: kwh,
    lossLkrYear: Number.isFinite(cost) && cost > 0 ? kwh * 365 * cost : null,
    txPeakPct: txPeak, protection: { pass: count('pass'), fail: count('fail'), missing: count('missing') },
    capexLkr: capex.lkr, capexKnownLkr: capex.knownLkr, capexMissing: capex.missing, converged
  };
}

// Which way is better for each compared row ('low' = smaller is better).
export const SCENARIO_ROWS = Object.freeze([
  { key: 'voltageViolations', label: 'Voltage violations (pole-phase-hours)', better: 'low', digits: 0 },
  { key: 'minV', label: 'Lowest voltage (V)', better: 'high', digits: 1 },
  { key: 'maxV', label: 'Highest voltage (V)', better: 'low', digits: 1 },
  { key: 'worstVufPct', label: 'Worst VUF (%)', better: 'low', digits: 2 },
  { key: 'lossKwhDay', label: 'Losses (kWh/day)', better: 'low', digits: 2 },
  { key: 'lossLkrYear', label: 'Losses (LKR/yr)', better: 'low', digits: 0 },
  { key: 'txPeakPct', label: 'Transformer peak (%)', better: 'low', digits: 0 },
  { key: 'protectionFails', label: 'Protection devices failing', better: 'low', digits: 0 },
  { key: 'capexLkr', label: 'Capex (LKR)', better: 'low', digits: 0 },
  { key: 'lkrYearSavedVsCurrent', label: 'Loss saving vs the current design (LKR/yr)', better: 'high', digits: 0 },
  { key: 'paybackYears', label: 'Simple payback (years)', better: 'low', digits: 1 },
  { key: 'npvLkr', label: 'NPV vs the current design (LKR)', better: 'high', digits: 0 }
]);

/**
 * Compares up to MAX_COMPARED_SCENARIOS scenarios; for each row, the ids holding the best value
 * (ties all marked; rows with fewer than two numbers mark nothing).
 * @param {Design} design @param {any[]} scenarios @param {ProgressHooks} [hooks]
 */
export function compareScenarios(design, scenarios, hooks = {}) {
  const list = scenarios.slice(0, MAX_COMPARED_SCENARIOS);
  const metrics = list.map((sc, i) => scenarioMetrics(design, sc, { onProgress: hooks.onProgress, stage: `Scenario ${i + 1} of ${list.length}: ${sc.name}` }));
  // Savings, payback and NPV are against the current design at each scenario's own year and
  // multipliers (P6.1); computed only when the energy cost of losses is set.
  const costSet = /** @type {any} */ (design).economics && Number(/** @type {any} */ (design).economics.lossCostLkrPerKwh) > 0;
  const baseKwh = new Map();
  const columns = metrics.map((m, i) => {
    let econ = { lkrYearSaved: null, paybackYears: null, npvLkr: null };
    if (costSet && list[i].id !== CURRENT_DESIGN_SCENARIO.id) {
      const key = `${m.year}|${m.loadMult}|${m.solarMult}`;
      if (!baseKwh.has(key)) baseKwh.set(key, scenarioMetrics(design, { ...CURRENT_DESIGN_SCENARIO, year: m.year, loadMult: m.loadMult, solarMult: m.solarMult }).lossKwhDay);
      econ = optionEconomics(design, { baseKwhDay: baseKwh.get(key), optionKwhDay: m.lossKwhDay, capexLkr: m.capexLkr });
    }
    return { ...m, protectionFails: m.protection.fail, lkrYearSavedVsCurrent: econ.lkrYearSaved, paybackYears: econ.paybackYears, npvLkr: econ.npvLkr };
  });
  /** @type {Record<string, string[]>} */
  const best = {};
  SCENARIO_ROWS.forEach(row => {
    const vals = columns.map(c => /** @type {any} */ (c)[row.key]).filter(v => Number.isFinite(v));
    if (vals.length < 2) { best[row.key] = []; return; }
    const target = row.better === 'low' ? Math.min(...vals) : Math.max(...vals);
    best[row.key] = columns.filter(c => Math.abs(/** @type {any} */ (c)[row.key] - target) <= 1e-9 * Math.max(1, Math.abs(target))).map(c => c.id);
  });
  return { columns, best };
}

/** The design as it is, as a scenario (nothing overridden). */
export const CURRENT_DESIGN_SCENARIO = Object.freeze({ id: '__current', name: 'Current design', year: 0, loadMult: 1, solarMult: 1, taps: {}, standardsProfileId: null, patch: null });
