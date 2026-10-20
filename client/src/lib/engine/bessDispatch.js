// @ts-check
// BESS with state of charge (P3.2).
//
// 'schedule' (the default, and the historical model) is a fixed ± power schedule with no energy
// limit — unchanged, handled directly in netS. The SOC-aware modes need the battery's energy, so a
// day is simulated hour by hour, carrying each unit's state of charge from one hour to the next:
//   - 'socSchedule': the same charge / discharge windows, but charging stops at socMax and
//     discharging at socMin, and each hour's power is limited by the energy left to move;
//   - 'solarFollowing': charge whenever the unit's transformer is exporting (judged from a solve
//     of that hour with the following units idle) or PV at its own pole exceeds the load there;
//     discharge across the evening discharge window until socMin.
// Energy bookkeeping per hour (1 h steps, P in kW = energy in kWh):
//   charging   at grid power Pc: stored energy rises by Pc·ηc;
//   discharging at grid power Pd: stored energy falls by Pd / ηd.
// ηc and ηd default to √RTE each (design.bessRte), so a full cycle loses exactly the RTE. The
// battery's energy capacity (kWh) is never assumed: a SOC-mode unit without one stays idle and is
// flagged dataMissing.
import { rangeHours } from './loads.js';
import { runSnapshot, warmStartFrom, topologyOf } from './solver.js';
import { connectionIndex } from './loads.js';
import { transformerOfPole } from './model.js';
/** @import { Design, SnapshotResult, BessConnection } from './types.js' */

export const BESS_MODES = ['schedule', 'socSchedule', 'solarFollowing'];

/** @param {any} b */
export function bessMode(b) { return BESS_MODES.includes(b && b.mode) ? b.mode : 'schedule'; }

/**
 * The SOC parameters of one unit, with defaults.
 * @param {Design} design @param {any} b
 */
export function bessParams(design, b) {
  const num = (v, d) => (v === null || v === '' || v === undefined || !Number.isFinite(Number(v)) ? d : Number(v));
  const rte = num(design.bessRte, 1);
  const eta = Math.sqrt(Math.min(Math.max(rte, 0), 1));
  const kWh = num(b.kWh, null);
  return {
    kva: num(b.kva, 0), kWh: kWh !== null && kWh > 0 ? kWh : null,
    socInitial: num(b.socInitial, 0.5), socMin: num(b.socMin, 0), socMax: num(b.socMax, 1),
    etaCharge: num(b.etaCharge, eta), etaDischarge: num(b.etaDischarge, eta)
  };
}

/** SOC-mode units that take part in the simulation. @param {Design} design */
export function socBessUnits(design) {
  return design.includeBess ? design.bess.filter(b => bessMode(b) !== 'schedule') : [];
}

/**
 * @typedef {{ id: string, pole: string, phase: string, mode: string, pKw: number, socStart: number, socEnd: number, dataMissing: boolean }} BessHour
 */

/**
 * Simulates hours 0 … lastHour sequentially with every SOC-mode unit dispatched by its rules.
 * Each returned snapshot carries `bess` (the units' power and SOC that hour). Returns null when the
 * design has no SOC-mode unit (callers then solve hours independently, as before).
 * @param {Design} design @param {number} year
 * @param {{ loadMult?: number, solarMult?: number, extraBess?: BessConnection[], lastHour?: number, warmStart?: boolean }} [opts]
 * @returns {(SnapshotResult & { bess: BessHour[] })[] | null}
 */
export function simulateBessDay(design, year, opts = {}) {
  const units = socBessUnits(design);
  if (!units.length) return null;
  const { loadMult = 1, solarMult = 1, extraBess = [], lastHour = 23, warmStart = true } = opts;
  const ctx = { index: connectionIndex(design), topo: topologyOf(design) };
  const params = new Map(units.map(b => [b.id, bessParams(design, b)]));
  const soc = new Map(units.map(b => [b.id, params.get(b.id).socInitial]));
  const chargeHours = new Set(rangeHours(design.bessChargeStartHour, design.bessChargeEndHour));
  const dischargeHours = new Set(rangeHours(design.bessDischargeStartHour, design.bessDischargeEndHour));
  const out = [];
  let prev = null;
  for (let hour = 0; hour <= lastHour; hour++) {
    const base = { year, hour, loadMult, solarMult, extraBess };
    const solve = (dispatch) => runSnapshot(design, { ...base, bessDispatch: dispatch }, { ...ctx, initialV: warmStart ? warmStartFrom(prev) : null });
    /** @type {Record<string, number>} */
    const dispatch = {};
    const charge = (b) => { const p = params.get(b.id); return -Math.min(p.kva, Math.max((p.socMax - soc.get(b.id)) * p.kWh / p.etaCharge, 0)); };
    const discharge = (b) => { const p = params.get(b.id); return Math.min(p.kva, Math.max((soc.get(b.id) - p.socMin) * p.kWh * p.etaDischarge, 0)); };
    const following = [];
    units.forEach(b => {
      if (params.get(b.id).kWh === null) { dispatch[b.id] = 0; return; }
      if (bessMode(b) === 'socSchedule') {
        dispatch[b.id] = chargeHours.has(hour) ? charge(b) : dischargeHours.has(hour) ? discharge(b) : 0;
      } else if (dischargeHours.has(hour)) {
        dispatch[b.id] = discharge(b);
      } else {
        dispatch[b.id] = 0;
        following.push(b);
      }
    });
    if (following.length) {
      // Solar-following units decide from this hour solved with them idle.
      const idle = solve(dispatch);
      const exporting = new Set(idle.transformers.filter(t => t.flowDirection === 'export').map(t => t.id));
      following.forEach(b => {
        if (exporting.has(transformerOfPole(design, b.pole)) || localPvExceedsLoad(design, b.pole, hour, solarMult, loadMult, year)) dispatch[b.id] = charge(b);
      });
    }
    const res = solve(dispatch);
    /** @type {BessHour[]} */
    const bess = units.map(b => {
      const p = params.get(b.id);
      const socStart = soc.get(b.id);
      const pKw = dispatch[b.id] || 0;
      let next = socStart;
      if (p.kWh !== null) next = pKw < 0 ? socStart + (-pKw) * p.etaCharge / p.kWh : socStart - pKw / p.etaDischarge / p.kWh;
      next = Math.min(Math.max(next, p.socMin - 1e-12), p.socMax + 1e-12);
      soc.set(b.id, next);
      return { id: b.id, pole: b.pole, phase: b.phase, mode: bessMode(b), pKw, socStart, socEnd: next, dataMissing: p.kWh === null };
    });
    out.push({ ...res, bess });
    prev = res;
  }
  return out;
}

// PV available at a pole vs the active power demanded there this hour (kW, nameplate × curves —
// the same quantities netS injects), for the "PV exceeds local load" rule.
function localPvExceedsLoad(design, pole, hour, solarMult, loadMult, year) {
  const growth = Math.pow(1 + design.growth / 100, year);
  const curveOf = (l) => (l.type === 'ev' ? design.evCurve : l.type === 'shop' ? design.shopCurve : l.type === 'evcs' ? design.evcsCurve : design.loadCurve);
  const included = { general: design.includeGeneral, ev: design.includeEV, shop: design.includeShop, evcs: design.includeEVCS };
  const pv = design.includeSolar ? design.pv.filter(p => p.pole === pole).reduce((s, p) => s + Number(p.kva) * design.solarCurve[hour] * solarMult, 0) : 0;
  const load = design.loads.filter(l => l.pole === pole && included[l.type]).reduce((s, l) => {
    const base = (l.kva == null || l.kva === '') ? design.admd : Number(l.kva);
    return s + base * curveOf(l)[hour] * growth * loadMult * design.pf;
  }, 0);
  return pv > load;
}
