// @ts-check
// Smart-inverter PV (P3.1): volt-var and volt-watt response and an optional export limit.
//
// A PV unit in 'unity' mode (the default — the app's historical behaviour) injects its available
// active power at unity power factor regardless of voltage. In the smart modes its output is a
// function of the voltage at its own connection point, recomputed inside the load-flow iteration
// exactly like the ZIP load multiplier (so the damped sweep settles P, Q and V together):
//   - volt-var: Q = Qcurve(V) × rated kVA (positive = injecting / capacitive, raises voltage;
//     negative = absorbing, lowers it);
//   - volt-watt: P ≤ Pcurve(V) × rated kVA (curtails active power at high voltage);
//   - both: volt-var and volt-watt together.
// Apparent power is limited to the rating with reactive-power priority (IEEE 1547-2018's default
// for volt-var): if P² + Q² would exceed S², P is reduced. An export limit (kW, per unit) then
// caps P. Curves are breakpoint tables in per unit of design.vnom, interpolated linearly and held
// flat beyond the end points.
//
// The seed curves are the IEEE 1547-2018 Category B defaults (Table 8 volt-var: 0.92/+0.44,
// 0.98/0, 1.02/0, 1.08/−0.44; Table 10 volt-watt: 1.06/1.0, 1.10/0.2 with P2 = 0.2 of rating).
// They are a placeholder labelled as such in the UI — replace them with the local grid code's.
/** @import { Design } from './types.js' */

export const INVERTER_MODES = ['unity', 'voltVar', 'voltWatt', 'voltVarWatt'];
export const IEEE1547_CAT_B = Object.freeze({
  voltVarCurve: Object.freeze([[0.92, 0.44], [0.98, 0], [1.02, 0], [1.08, -0.44]]),
  voltWattCurve: Object.freeze([[1.06, 1.0], [1.10, 0.2]])
});

/**
 * @typedef {object} InverterSettings
 * @property {'unity' | 'voltVar' | 'voltWatt' | 'voltVarWatt'} mode
 * @property {number[][]} voltVarCurve   [[V pu, Q pu of rated kVA], …], V ascending.
 * @property {number[][]} voltWattCurve  [[V pu, P pu of rated kVA], …], V ascending.
 * @property {number | null} exportLimitKw Per-unit active-power cap, kW (null = none).
 */

/** @param {Design} design @returns {InverterSettings} */
export function inverterSettings(design) {
  const s = /** @type {any} */ (design).inverter || {};
  const curve = (c, d) => (Array.isArray(c) && c.length >= 1 && c.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)) ? c : d);
  const lim = s.exportLimitKw;
  return {
    mode: INVERTER_MODES.includes(s.mode) ? s.mode : 'unity',
    voltVarCurve: curve(s.voltVarCurve, IEEE1547_CAT_B.voltVarCurve),
    voltWattCurve: curve(s.voltWattCurve, IEEE1547_CAT_B.voltWattCurve),
    exportLimitKw: lim === null || lim === '' || lim === undefined || !Number.isFinite(Number(lim)) ? null : Number(lim)
  };
}

/** Piecewise-linear lookup, flat beyond the ends. @param {number[][]} curve @param {number} x */
export function interpolateCurve(curve, x) {
  const pts = [...curve].sort((a, b) => a[0] - b[0]);
  if (x <= pts[0][0]) return pts[0][1];
  if (x >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      return x1 === x0 ? y1 : y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
  }
  return pts[pts.length - 1][1];
}

/** The mode a PV unit runs in: its own override, else the design's. @param {any} pv @param {InverterSettings} s */
export function unitMode(pv, s) {
  return pv && INVERTER_MODES.includes(pv.inverterMode) ? pv.inverterMode : s.mode;
}

/**
 * One unit's output at per-unit voltage vPu: P and Q in kW / kVAR, generation positive.
 * @param {{ kva: number, pAvail: number, mode: string }} unit  kva = rating; pAvail = sun-limited P.
 * @param {number} vPu @param {InverterSettings} s
 * @returns {{ p: number, q: number }}
 */
export function inverterOutput(unit, vPu, s) {
  const S = Math.max(unit.kva, 0);
  let p = Math.max(unit.pAvail, 0);
  let q = 0;
  if (unit.mode === 'voltWatt' || unit.mode === 'voltVarWatt') p = Math.min(p, Math.max(interpolateCurve(s.voltWattCurve, vPu), 0) * S);
  if (unit.mode === 'voltVar' || unit.mode === 'voltVarWatt') q = interpolateCurve(s.voltVarCurve, vPu) * S;
  if (Math.abs(q) > S) q = Math.sign(q) * S;
  if (p * p + q * q > S * S) p = Math.sqrt(Math.max(S * S - q * q, 0)); // reactive priority
  if (s.exportLimitKw !== null) p = Math.min(p, s.exportLimitKw);
  return { p, q };
}
