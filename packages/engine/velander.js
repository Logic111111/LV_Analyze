// @ts-check
// Demand from billing data — the Velander formula (P6.2). For a general connection with a known
// annual energy W (kWh), the peak demand is
//     P_peak (kW) = k1·W + k2·√W,   peak kVA = P_peak / pf
// which replaces the design's ADMD for that connection (when its kVA is blank and the option is
// on). k1 and k2 are never assumed: the user enters them, or fits them to measured pairs of
// (annual kWh, peak kW) by linear least squares on the basis [W, √W] (no intercept, as in the
// formula):  minimise Σ (P − k1·W − k2·√W)²  →  normal equations
//     [Σ W²   Σ W^1.5] [k1]   [Σ P·W ]
//     [Σ W^1.5  Σ W  ] [k2] = [Σ P·√W]
// R² is reported against the mean of the measured peaks.
/** @import { Design, Connection } from './types.js' */

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** @param {Design} design */
export function velanderSettings(design) {
  const v = /** @type {any} */ (design).velander || {};
  return { enabled: !!v.enabled, k1: num(v.k1), k2: num(v.k2) };
}

/** Peak kVA from annual kWh, or null when Velander is off, constants are missing or W isn't a positive number. @param {Design} design @param {any} annualKWh */
export function velanderPeakKva(design, annualKWh) {
  const s = velanderSettings(design);
  const W = num(annualKWh);
  if (!s.enabled || s.k1 === null || s.k2 === null || W === null || W <= 0) return null;
  return (s.k1 * W + s.k2 * Math.sqrt(W)) / Number(design.pf);
}

/**
 * The kVA a connection is modelled at before curves and growth: its own kVA when entered; else,
 * for a general connection with annual kWh and Velander on, the Velander peak; else the ADMD.
 * Every engine path that substitutes ADMD uses this, so they all agree.
 * @param {Design} design @param {Connection} load
 */
export function basePeakKva(design, load) {
  if (!(load.kva == null || /** @type {any} */ (load.kva) === '')) return Number(load.kva);
  if (load.type === 'general') {
    const v = velanderPeakKva(design, /** @type {any} */ (load).annualKWh);
    if (v !== null) return v;
  }
  return design.admd;
}

/**
 * Least-squares fit of k1, k2 to (annual kWh, peak kW) pairs.
 * @param {{ annualKWh: number, peakKw: number }[]} pairs
 * @returns {{ k1: number, k2: number, r2: number, n: number, residuals: { annualKWh: number, peakKw: number, fittedKw: number, residualKw: number }[] } | { error: string }}
 */
export function fitVelander(pairs) {
  const pts = pairs.filter(p => Number.isFinite(p.annualKWh) && p.annualKWh > 0 && Number.isFinite(p.peakKw));
  if (pts.length < 2) return { error: 'Need at least two (annual kWh, peak kW) pairs.' };
  let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
  pts.forEach(({ annualKWh: W, peakKw: P }) => {
    const s = Math.sqrt(W);
    a11 += W * W; a12 += W * s; a22 += W; b1 += P * W; b2 += P * s;
  });
  const det = a11 * a22 - a12 * a12;
  // [W, √W] are collinear only when every W is the same; scale-aware test.
  if (Math.abs(det) <= 1e-12 * a11 * a22) return { error: 'The annual energies are all the same, so k1 and k2 cannot be separated — include customers with different consumption.' };
  const k1 = (b1 * a22 - b2 * a12) / det;
  const k2 = (a11 * b2 - a12 * b1) / det;
  const residuals = pts.map(({ annualKWh: W, peakKw: P }) => { const f = k1 * W + k2 * Math.sqrt(W); return { annualKWh: W, peakKw: P, fittedKw: f, residualKw: P - f }; });
  const mean = pts.reduce((s, p) => s + p.peakKw, 0) / pts.length;
  const ssTot = pts.reduce((s, p) => s + (p.peakKw - mean) ** 2, 0);
  const ssRes = residuals.reduce((s, r) => s + r.residualKw ** 2, 0);
  return { k1, k2, r2: ssTot > 0 ? 1 - ssRes / ssTot : 1, n: pts.length, residuals };
}

/**
 * CSV of annual kWh and peak kW, one pair per line; comma, semicolon or tab separated; a header
 * line (any non-numeric first line) is skipped. Lines that don't parse are reported, not guessed.
 * @param {string} text
 */
export function parseVelanderCsv(text) {
  const pairs = [], errors = [];
  String(text).split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    const cells = t.split(/[,;\t]/).map(c => c.trim());
    const W = Number(cells[0]), P = Number(cells[1]);
    if (cells.length < 2 || !Number.isFinite(W) || !Number.isFinite(P)) {
      if (i === 0) return; // header
      errors.push(`Line ${i + 1}: "${t}" is not two numbers`);
      return;
    }
    pairs.push({ annualKWh: W, peakKw: P });
  });
  return { pairs, errors };
}
