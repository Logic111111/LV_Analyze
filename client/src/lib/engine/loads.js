// @ts-check
// Per-pole complex power injections for one hour: demand (ADMD/curves/growth, optional ZIP
// voltage dependence), rooftop PV, and the BESS charge/discharge schedule.
import { C, PHASES } from './complex.js';
import { inverterSettings, unitMode } from './inverter.js';
/** @import { Design, Connection, PvConnection, Complex, ConnectionPhase } from './types.js' */

/* ============================================================
   LOADS, PV AND BESS INJECTIONS
============================================================ */
/** @param {Design} design @param {Connection} load @param {number} year @param {number} hour @returns {number} kVA */
export function loadKvaAt(design, load, year, hour) {
  const curve = load.type === 'ev' ? design.evCurve : load.type === 'shop' ? design.shopCurve : load.type === 'evcs' ? design.evcsCurve : design.loadCurve;
  const base = (load.kva == null || load.kva === '') ? design.admd : Number(load.kva);
  const growthFactor = Math.pow(1 + design.growth / 100, year);
  return base * curve[hour] * growthFactor;
}
/** @param {Design} design @param {PvConnection} pv @param {number} hour @returns {number} kVA */
export function pvKvaAt(design, pv, hour) { return Number(pv.kva) * design.solarCurve[hour]; }

// Hours in [start, end), wrapping past midnight if end <= start (empty if start === end).
/** @param {number} start @param {number} end @returns {number[]} */
export function rangeHours(start, end) {
  const span = end === start ? 0 : (((end - start) % 24) + 24) % 24 || 24;
  return [...Array(span).keys()].map(i => (start + i) % 24);
}

// BESS is a fixed-power charge/discharge schedule (no state-of-charge tracking): +1 while
// discharging (behaves like PV export), -1 while charging (behaves like a unity-pf load), 0
// otherwise. Windows are whole clock hours since the engine solves one snapshot per hour.
/** @param {Design} design @param {number} hour @returns {-1 | 0 | 1} */
export function bessMultiplierAt(design, hour) {
  if (rangeHours(design.bessChargeStartHour, design.bessChargeEndHour).includes(hour)) return -1;
  if (rangeHours(design.bessDischargeStartHour, design.bessDischargeEndHour).includes(hour)) return 1;
  return 0;
}

// Every connection grouped by pole and kind, each group in its original list order. Built once per
// snapshot (or once per scan by the caller) instead of re-filtering every list for every pole —
// and, inside the solver, on every iteration, as netS used to be. Because each group keeps list
// order, netS adds injections up in exactly the same sequence as before, so results are
// bit-identical. Loads of a type the engine doesn't model are left out, as the old per-type
// filters left them out.
/** @typedef {{ loads: { general: import('./types.js').Connection[], ev: import('./types.js').Connection[], shop: import('./types.js').Connection[], evcs: import('./types.js').Connection[] }, pv: PvConnection[], bess: import('./types.js').BessConnection[] }} PoleConnections */
/** @typedef {Map<string, PoleConnections>} ConnectionIndex */
const LOAD_TYPES = ['general', 'ev', 'shop', 'evcs'];
/** @type {PoleConnections} */
const NO_CONNECTIONS = Object.freeze({ loads: Object.freeze({ general: [], ev: [], shop: [], evcs: [] }), pv: [], bess: [] });

/** @param {Design} design @returns {ConnectionIndex} */
export function connectionIndex(design) {
  /** @type {ConnectionIndex} */
  const byPole = new Map();
  /** @param {string} pole */
  const slot = (pole) => {
    let s = byPole.get(pole);
    if (!s) byPole.set(pole, s = { loads: { general: [], ev: [], shop: [], evcs: [] }, pv: [], bess: [] });
    return s;
  };
  design.loads.forEach(l => { if (LOAD_TYPES.includes(l.type)) slot(l.pole).loads[l.type].push(l); });
  design.pv.forEach(p => slot(p.pole).pv.push(p));
  design.bess.forEach(b => slot(b.pole).bess.push(b));
  return byPole;
}

// Per-pole net complex power injection at a given hour/year, split into `loadS` (general/EV/shop
// connections — positive, the only injections the ZIP voltage-dependence below ever applies to)
// and `otherS` (rooftop PV and BESS charge/discharge — always constant-power, since a ZIP mix
// describes end-use demand, not grid-tied inverter behaviour). Shared across every transformer's
// subtree since it only depends on which poles a load/PV/BESS sits on, not which transformer
// feeds them.
/**
 * @param {Design} design @param {string} poleId @param {number} year @param {number} hour
 * @param {number} loadMult @param {number} solarMult
 * @param {PvConnection[]} extraPV @param {PvConnection[]} [extraBess]
 * @param {ConnectionIndex} [index] Prebuilt connectionIndex(design); built here if omitted.
 * @param {Record<string, number> | null} [bessDispatch] Grid power of SOC-mode BESS units this hour,
 *   kW (+ discharging, − charging), from simulateBessDay; a SOC-mode unit missing here is idle.
 * @returns {{ loadS: import('./types.js').PhaseMap<Complex>, otherS: import('./types.js').PhaseMap<Complex>, smart: { id?: string, phase: import('./types.js').Phase, kva: number, pAvail: number, mode: string }[] }} kVA
 */
export function netS(design, poleId, year, hour, loadMult, solarMult, extraPV, extraBess = [], index = undefined, bessDispatch = null) {
  const conns = (index || connectionIndex(design)).get(poleId) || NO_CONNECTIONS;
  const loadS = { A: C.zero(), B: C.zero(), C: C.zero() };
  const otherS = { A: C.zero(), B: C.zero(), C: C.zero() };
  const addTo = (bucket, phase, kva, pf, sign) => {
    const p = kva * pf, q = kva * Math.sqrt(Math.max(1 - pf * pf, 0)) * sign;
    const s = { re: p * sign, im: q };
    if (phase === 'ABC') { PHASES.forEach(ph => { bucket[ph] = C.add(bucket[ph], C.mulS(s, 1 / 3)); }); }
    else { bucket[phase] = C.add(bucket[phase], s); }
  };
  if (design.includeGeneral) {
    conns.loads.general.forEach(l => {
      addTo(loadS, l.phase, loadKvaAt(design, l, year, hour) * loadMult, design.pf, +1);
    });
  }
  if (design.includeEV) {
    conns.loads.ev.forEach(l => {
      addTo(loadS, l.phase, loadKvaAt(design, l, year, hour) * loadMult, design.pf, +1);
    });
  }
  if (design.includeShop) {
    conns.loads.shop.forEach(l => {
      addTo(loadS, l.phase, loadKvaAt(design, l, year, hour) * loadMult, design.pf, +1);
    });
  }
  if (design.includeEVCS) {
    conns.loads.evcs.forEach(l => {
      addTo(loadS, l.phase, loadKvaAt(design, l, year, hour) * loadMult, design.pf, +1);
    });
  }
  // PV: a unity-pf unit with no export limit (the default, and the historical behaviour) is a
  // constant injection in otherS exactly as before. A unit in a smart mode, or under an export
  // limit, is returned in `smart` instead: its P and Q depend on the local voltage and are set
  // inside the solver iteration (see inverter.js). A 3-phase unit becomes three single-phase
  // thirds, each answering to its own phase voltage.
  const inv = inverterSettings(design);
  /** @type {{ id?: string, phase: import('./types.js').Phase, kva: number, pAvail: number, mode: string }[]} */
  const smart = [];
  const addPv = (/** @type {any} */ p, /** @type {number} */ pAvail) => {
    const mode = unitMode(p, inv);
    if (mode === 'unity' && inv.exportLimitKw === null) { addTo(otherS, p.phase, pAvail, 1.0, -1); return; }
    const kva = Number(p.kva);
    if (p.phase === 'ABC') PHASES.forEach(ph => smart.push({ id: p.id, phase: ph, kva: kva / 3, pAvail: pAvail / 3, mode }));
    else smart.push({ id: p.id, phase: p.phase, kva, pAvail, mode });
  };
  if (design.includeSolar) {
    conns.pv.forEach(p => addPv(p, pvKvaAt(design, p, hour) * solarMult));
  }
  extraPV.filter(p => p.pole === poleId).forEach(p => addPv(p, Number(p.kva) * solarMult));
  // Round-trip efficiency is modelled as a derate on the discharge (export) side only — charge
  // draw from the grid stays at the connection's full rated kVA (that's genuinely what gets
  // pulled from the network), while discharge output is scaled down by bessRte. With no
  // state-of-charge tracking there's no real "energy in vs. energy out" to split the loss across,
  // so this is the standard simplification: the round-trip loss shows up as reduced usable output.
  const rte = design.bessRte ?? 1;
  if (design.includeBess) {
    conns.bess.forEach(b => {
      // SOC-aware units (P3.2) inject exactly what the day simulation dispatched — no RTE derate
      // here: their efficiencies are applied to the stored energy instead.
      if (b.mode === 'socSchedule' || b.mode === 'solarFollowing') {
        const p = bessDispatch && Number.isFinite(bessDispatch[b.id]) ? bessDispatch[b.id] : 0;
        if (p > 0) addTo(otherS, b.phase, p, 1.0, -1);
        else if (p < 0) addTo(otherS, b.phase, -p, 1.0, +1);
        return;
      }
      const mult = bessMultiplierAt(design, hour);
      if (mult > 0) addTo(otherS, b.phase, Number(b.kva) * mult * rte, 1.0, -1);
      else if (mult < 0) addTo(otherS, b.phase, Number(b.kva) * Math.abs(mult), 1.0, +1);
    });
  }
  extraBess.filter(b => b.pole === poleId).forEach(b => {
    const mult = bessMultiplierAt(design, hour);
    if (mult > 0) addTo(otherS, b.phase, Number(b.kva) * mult * rte, 1.0, -1);
    else if (mult < 0) addTo(otherS, b.phase, Number(b.kva) * Math.abs(mult), 1.0, +1);
  });
  return { loadS, otherS, smart };
}

// ZIP voltage-dependence multiplier: P(V) = P0·[aZ·(V/V0)² + aI·(V/V0) + aP], and the same ratio
// applied to Q too (one shared coefficient set, rather than separate ones for P and Q, to keep
// the Setup page to a single control — a deliberate simplification of the general ZIP model).
// V0 is the nominal phase-neutral voltage (design.vnom). Constant-power mode (the historical,
// still-default behaviour) is exactly aZ=0, aI=0, aP=1 — this returns 1 unconditionally whenever
// design.loadModel isn't 'zip', so every existing design's results are unaffected.
/** @param {Design} design @param {number} vAbs @returns {number} */
export function zipMultiplier(design, vAbs) {
  if (design.loadModel !== 'zip') return 1;
  const r = vAbs / design.vnom;
  return (design.zipZ ?? 0) * r * r + (design.zipI ?? 0) * r + (design.zipP ?? 1);
}
