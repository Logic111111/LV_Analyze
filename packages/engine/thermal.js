// @ts-check
// Transformer thermal ageing (P3.3) — IEC 60076-7 difference-equation method (clause 8.2.3), from
// the hourly loading of a 24 h scan and an hourly ambient profile.
//
//   Dθo   = Dt/(k11·τo)      · ( [(1 + K²R)/(1 + R)]^x · Δθor − (θo − θa) )     top-oil
//   DΔθh1 = Dt/(k22·τw)      · ( k21·Hgr·K^y − Δθh1 )                           winding
//   DΔθh2 = Dt/((1/k22)·τo)  · ( (k21 − 1)·Hgr·K^y − Δθh2 )                     oil-flow term
//   θh    = θo + Δθh1 − Δθh2                                                      hot spot
// K = load factor (|S| / rated), held constant within each hour of the scan; θa = ambient.
// Relative ageing rate, non-thermally-upgraded paper: V = 2^((θh − 98)/6); loss of life over a
// period = ∫V dt (equivalent hours at the 98 °C reference). Dt = 1 min, well inside τw.
//
// The day is repeated until it is periodic (start-of-day temperatures stop changing), so the result
// doesn't depend on a guessed initial state.
//
// Default parameters are IEC 60076-7's ONAN distribution-transformer values (oil exponent 0.8,
// winding exponent 1.6, loss ratio 5, k11 1.0, k21 1.0, k22 2.0, τo 180 min, τw 4 min) with a
// top-oil rise of 55 K and hot-spot-to-top-oil gradient of 23 K, which put the rated hot spot at
// the 98 °C ageing reference for a 20 °C ambient. All are editable and should be replaced with the
// transformer's heat-run test values (Δθor, Hgr) where known. The ambient profile is prefilled flat
// at 20 °C — the IEC reference ambient, NOT local climate data; enter the site's hourly ambient.
/** @import { Design, SnapshotResult } from './types.js' */

export const THERMAL_DEFAULTS = Object.freeze({
  ambientC: Object.freeze(Array(24).fill(20)),
  oilExponentX: 0.8, windingExponentY: 1.6, lossRatioR: 5,
  k11: 1.0, k21: 1.0, k22: 2.0, tauOilMin: 180, tauWindingMin: 4,
  topOilRiseK: 55, hotSpotGradientK: 23
});

/** @param {Design} design */
export function thermalSettings(design) {
  const t = /** @type {any} */ (design).thermal || {};
  const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);
  const amb = Array.isArray(t.ambientC) && t.ambientC.length === 24 && t.ambientC.every(v => Number.isFinite(Number(v))) ? t.ambientC.map(Number) : [...THERMAL_DEFAULTS.ambientC];
  /** @type {any} */ const out = { ambientC: amb };
  Object.keys(THERMAL_DEFAULTS).forEach(k => { if (k !== 'ambientC') out[k] = num(t[k], THERMAL_DEFAULTS[k]); });
  return /** @type {typeof THERMAL_DEFAULTS & { ambientC: number[] }} */ (out);
}

/** Relative ageing rate, non-thermally-upgraded paper. @param {number} thetaH */
export function ageingRate(thetaH) { return Math.pow(2, (thetaH - 98) / 6); }

/**
 * Hot-spot temperature over a repeated day.
 * @param {number[]} kHourly  24 load factors (|S| / rated).
 * @param {number[]} ambientHourly 24 ambient temperatures, °C.
 * @param {ReturnType<typeof thermalSettings>} p
 * @param {{ maxDays?: number, tol?: number }} [opts]
 */
export function simulateHotSpot(kHourly, ambientHourly, p, opts = {}) {
  const maxDays = opts.maxDays ?? 30, tol = opts.tol ?? 1e-4;
  const dt = 1; // minute
  const { oilExponentX: x, windingExponentY: y, lossRatioR: R, k11, k21, k22, tauOilMin: to, tauWindingMin: tw, topOilRiseK: dor, hotSpotGradientK: hgr } = p;
  // Start from the steady state of the first hour.
  const K0 = kHourly[0];
  let thetaO = ambientHourly[0] + Math.pow((1 + K0 * K0 * R) / (1 + R), x) * dor;
  let dh1 = k21 * hgr * Math.pow(K0, y), dh2 = (k21 - 1) * hgr * Math.pow(K0, y);
  let day = null, days = 0;
  for (days = 1; days <= maxDays; days++) {
    const start = [thetaO, dh1, dh2];
    const hours = [];
    let lossOfLifeH = 0;
    for (let h = 0; h < 24; h++) {
      const K = Math.max(kHourly[h], 0), thetaA = ambientHourly[h];
      const oilTarget = Math.pow((1 + K * K * R) / (1 + R), x) * dor;
      const windTarget = hgr * Math.pow(K, y);
      let peak = -Infinity, vSum = 0;
      for (let m = 0; m < 60; m++) {
        thetaO += dt / (k11 * to) * (oilTarget - (thetaO - thetaA));
        dh1 += dt / (k22 * tw) * (k21 * windTarget - dh1);
        dh2 += dt / ((1 / k22) * to) * ((k21 - 1) * windTarget - dh2);
        const thetaH = thetaO + dh1 - dh2;
        if (thetaH > peak) peak = thetaH;
        vSum += ageingRate(thetaH);
      }
      const v = vSum / 60;
      lossOfLifeH += v; // 1 h × mean V over the hour
      hours.push({ hour: h, K, ambientC: thetaA, topOilC: thetaO, hotSpotC: thetaO + dh1 - dh2, peakHotSpotC: peak, ageingRate: v });
    }
    day = { hours, lossOfLifeH };
    const moved = Math.max(Math.abs(thetaO - start[0]), Math.abs(dh1 - start[1]), Math.abs(dh2 - start[2]));
    if (moved < tol) break;
  }
  const peak = day.hours.reduce((m, h) => (h.peakHotSpotC > m.peakHotSpotC ? h : m));
  return {
    hours: day.hours,
    peakHotSpotC: peak.peakHotSpotC, peakHour: peak.hour,
    lossOfLifeHoursPerDay: day.lossOfLifeH,
    relativeAgeing: day.lossOfLifeH / 24,
    daysToPeriodic: Math.min(days, maxDays), periodic: days <= maxDays
  };
}

/**
 * Ageing of every transformer from a 24 h scan of the design.
 * @param {Design} design @param {SnapshotResult[]} scan 24 hourly snapshots (hour 0 … 23).
 */
export function transformerAgeing(design, scan) {
  const p = thermalSettings(design);
  return design.transformers.map(tx => {
    const rated = Number(tx.txRating);
    const k = scan.map(r => { const t = r.transformers.find(x => x.id === tx.id); return t ? t.txKVA / rated : 0; });
    return { id: tx.id, name: tx.name || tx.id, ...simulateHotSpot(k, p.ambientC, p) };
  });
}
