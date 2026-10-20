// @ts-check
// Economics (P6.1). Every number here is the user's (design.economics, plus each conductor's
// costPerM in the conductor library); nothing is defaulted. A figure that needs a missing input
// is null and the UI says "not set".
//
//   annual loss (kWh/yr)   = daily loss × 365 — one representative day stands for the year, a
//                            stated simplification (no seasonal or growth variation within it);
//   LKR/yr saved           = (base − option) kWh/yr × energy cost of losses (LKR/kWh);
//   capex                  = re-strung spans × their conductor cost per metre + connection moves ×
//                            rewiring cost + new transformers at their cost by rating + tap
//                            changes × the tap-change / outage cost;
//   simple payback (years) = capex / LKR saved per year (when the saving is positive);
//   NPV (LKR)              = −capex + Σ_{t=1..N} saving / (1 + r)^t, end-of-year savings over the
//                            study period N at discount rate r.
import { getConductor } from './model.js';
/** @import { Design } from './types.js' */

export const ECONOMICS_DEFAULTS = Object.freeze({
  lossCostLkrPerKwh: null, discountRatePct: null, studyYears: null,
  rewirePerMoveLkr: null, tapChangeLkr: null, transformerCostLkr: {}
});

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** The economics inputs, numbers or null. @param {Design} design */
export function economicsOf(design) {
  const e = /** @type {any} */ (design).economics || {};
  const tx = {};
  Object.entries(e.transformerCostLkr || {}).forEach(([k, v]) => { if (num(v) !== null) tx[k] = num(v); });
  return {
    lossCostLkrPerKwh: num(e.lossCostLkrPerKwh), discountRatePct: num(e.discountRatePct), studyYears: num(e.studyYears),
    rewirePerMoveLkr: num(e.rewirePerMoveLkr), tapChangeLkr: num(e.tapChangeLkr), transformerCostLkr: tx
  };
}

/**
 * Capital cost of turning `base` into `variant`, item by item. `lkr` is null when any item's unit
 * cost is missing; `knownLkr` is the sum of the items that are priced.
 * @param {Design} base @param {Design} variant @param {Design} [costsFrom] design whose economics and library apply (default: variant)
 */
export function capexOf(base, variant, costsFrom = variant) {
  const e = economicsOf(costsFrom);
  /** @type {{ what: string, qty: number, unitLkr: number | null, lkr: number | null }[]} */
  const items = [];
  const basePoles = new Map(base.poles.map(p => [p.id, p]));
  variant.poles.forEach(p => {
    const b = basePoles.get(p.id);
    if (b && b.cond !== p.cond) {
      const c = num(/** @type {any} */ (getConductor(costsFrom, p.cond)).costPerM);
      items.push({ what: `Restring span into ${p.id} with ${p.cond} (m)`, qty: Number(p.spanM) || 0, unitLkr: c, lkr: c === null ? null : c * (Number(p.spanM) || 0) });
    }
  });
  let moves = 0;
  ['loads', 'pv', 'bess'].forEach(k => {
    const m = new Map(/** @type {any[]} */ (base[k]).map(x => [x.id, x.phase]));
    /** @type {any[]} */ (variant[k]).forEach(x => { if (m.has(x.id) && m.get(x.id) !== x.phase) moves++; });
  });
  if (moves) items.push({ what: 'Connection moved to another phase', qty: moves, unitLkr: e.rewirePerMoveLkr, lkr: e.rewirePerMoveLkr === null ? null : moves * e.rewirePerMoveLkr });
  variant.transformers.filter(t => !base.transformers.some(b => b.id === t.id)).forEach(t => {
    const c = e.transformerCostLkr[String(t.txRating)] ?? null;
    items.push({ what: `New ${t.txRating} kVA transformer (${t.id})`, qty: 1, unitLkr: c, lkr: c });
  });
  const taps = variant.transformers.filter(t => { const b = base.transformers.find(x => x.id === t.id); return b && b.tap !== t.tap; }).length;
  if (taps) items.push({ what: 'Tap change (outage)', qty: taps, unitLkr: e.tapChangeLkr, lkr: e.tapChangeLkr === null ? null : taps * e.tapChangeLkr });
  const missing = items.filter(i => i.lkr === null).map(i => i.what.replace(/ \(.*\)$/, ''));
  const knownLkr = items.reduce((s, i) => s + (i.lkr || 0), 0);
  return { items, lkr: missing.length ? null : knownLkr, knownLkr, missing };
}

/** NPV of an end-of-year saving stream. @param {number} capex @param {number} annualSaving @param {number} ratePct @param {number} years */
export function npv(capex, annualSaving, ratePct, years) {
  const r = ratePct / 100;
  let pv = 0;
  for (let t = 1; t <= years; t++) pv += annualSaving / Math.pow(1 + r, t);
  return pv - capex;
}

/**
 * Economics of one option against a base: kWh/yr and LKR/yr saved, capex, payback, NPV.
 * @param {Design} design whose economics apply
 * @param {{ baseKwhDay: number, optionKwhDay: number, capexLkr: number | null }} o
 */
export function optionEconomics(design, o) {
  const e = economicsOf(design);
  const kwhYearSaved = (o.baseKwhDay - o.optionKwhDay) * 365;
  const lkrYearSaved = e.lossCostLkrPerKwh === null ? null : kwhYearSaved * e.lossCostLkrPerKwh;
  const capex = o.capexLkr;
  const paybackYears = lkrYearSaved !== null && capex !== null && lkrYearSaved > 0 ? capex / lkrYearSaved : null;
  const npvLkr = lkrYearSaved !== null && capex !== null && e.discountRatePct !== null && e.studyYears !== null && e.studyYears > 0
    ? npv(capex, lkrYearSaved, e.discountRatePct, Math.round(e.studyYears)) : null;
  return { annualLossKwhBase: o.baseKwhDay * 365, annualLossKwhOption: o.optionKwhDay * 365, kwhYearSaved, lkrYearSaved, capexLkr: capex, paybackYears, npvLkr };
}
