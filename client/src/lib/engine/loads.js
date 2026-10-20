// @ts-check
// Per-pole complex power injections for one hour: demand (ADMD/curves/growth, optional ZIP
// voltage dependence), rooftop PV, and the BESS charge/discharge schedule.
import { C, PHASES } from './complex.js';
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
 * @returns {{ loadS: import('./types.js').PhaseMap<Complex>, otherS: import('./types.js').PhaseMap<Complex> }} kVA
 */
export function netS(design, poleId, year, hour, loadMult, solarMult, extraPV, extraBess = []) {
  const loadS = { A: C.zero(), B: C.zero(), C: C.zero() };
  const otherS = { A: C.zero(), B: C.zero(), C: C.zero() };
  const addTo = (bucket, phase, kva, pf, sign) => {
    const p = kva * pf, q = kva * Math.sqrt(Math.max(1 - pf * pf, 0)) * sign;
    const s = { re: p * sign, im: q };
    if (phase === 'ABC') { PHASES.forEach(ph => { bucket[ph] = C.add(bucket[ph], C.mulS(s, 1 / 3)); }); }
    else { bucket[phase] = C.add(bucket[phase], s); }
  };
  if (design.includeGeneral) {
    design.loads.filter(l => l.pole === poleId && l.type === 'general').forEach(l => {
      addTo(loadS, l.phase, loadKvaAt(design, l, year, hour) * loadMult, design.pf, +1);
    });
  }
  if (design.includeEV) {
    design.loads.filter(l => l.pole === poleId && l.type === 'ev').forEach(l => {
      addTo(loadS, l.phase, loadKvaAt(design, l, year, hour) * loadMult, design.pf, +1);
    });
  }
  if (design.includeShop) {
    design.loads.filter(l => l.pole === poleId && l.type === 'shop').forEach(l => {
      addTo(loadS, l.phase, loadKvaAt(design, l, year, hour) * loadMult, design.pf, +1);
    });
  }
  if (design.includeEVCS) {
    design.loads.filter(l => l.pole === poleId && l.type === 'evcs').forEach(l => {
      addTo(loadS, l.phase, loadKvaAt(design, l, year, hour) * loadMult, design.pf, +1);
    });
  }
  if (design.includeSolar) {
    design.pv.filter(p => p.pole === poleId).forEach(p => {
      addTo(otherS, p.phase, pvKvaAt(design, p, hour) * solarMult, 1.0, -1);
    });
  }
  extraPV.filter(p => p.pole === poleId).forEach(p => {
    addTo(otherS, p.phase, Number(p.kva) * solarMult, 1.0, -1);
  });
  // Round-trip efficiency is modelled as a derate on the discharge (export) side only — charge
  // draw from the grid stays at the connection's full rated kVA (that's genuinely what gets
  // pulled from the network), while discharge output is scaled down by bessRte. With no
  // state-of-charge tracking there's no real "energy in vs. energy out" to split the loss across,
  // so this is the standard simplification: the round-trip loss shows up as reduced usable output.
  const rte = design.bessRte ?? 1;
  if (design.includeBess) {
    design.bess.filter(b => b.pole === poleId).forEach(b => {
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
  return { loadS, otherS };
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
