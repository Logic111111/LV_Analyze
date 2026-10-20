// @ts-check
// Coupled line model (P3.5, behind a flag). By default (design.lineModel 'simple') each span is
// the historical uncoupled model: phase self-impedance Zph on each phase, neutral Zn on the
// neutral. With design.lineModel = 'coupled', a conductor entry may carry `zMatrix` — the full 4×4
// series impedance matrix per km of the phase and neutral conductors, rows/columns in the order
// A, B, C, N, entries as {re, im} or [re, im] — and spans of that conductor then use it:
//   currents leaving the parent along the span: I = [Ia, Ib, Ic, −(Ia + Ib + Ic)]  (neutral return)
//   conductor voltage drops ΔV = Z·I, and the phase-to-neutral voltage at the far end is
//   V(parent) − (ΔV_ph − ΔV_N).
// The matrix is the user's (e.g. from Carson's equations for their cable geometry) — no geometry is
// assumed here. A diagonal matrix built from today's values reproduces the simple model exactly
// (the arithmetic is arranged so the zero mutual terms change nothing, bit for bit).
//
// Limitation: in a subtree with an earth electrode the neutral is solved as a nodal network from
// each span's neutral self-impedance; mutual coupling is not carried into that network, so such
// subtrees keep the uncoupled model (flagged in the result as couplingIgnored).
/** @import { Complex } from './types.js' */

/** @param {any} v @returns {Complex | null} */
function complexOf(v) {
  if (Array.isArray(v) && v.length === 2 && v.every(x => Number.isFinite(Number(x)))) return { re: Number(v[0]), im: Number(v[1]) };
  if (v && typeof v === 'object' && Number.isFinite(Number(v.re)) && Number.isFinite(Number(v.im))) return { re: Number(v.re), im: Number(v.im) };
  return null;
}

/** A valid 4×4 complex matrix, or null. @param {any} raw @returns {Complex[][] | null} */
export function parseZMatrix(raw) {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const m = raw.map(row => (Array.isArray(row) && row.length === 4 ? row.map(complexOf) : null));
  return m.every(row => row && row.every(Boolean)) ? /** @type {Complex[][]} */ (m) : null;
}

/** The coupled matrix to use for a conductor, or null for the simple model. @param {any} design @param {any} conductor */
export function couplingMatrix(design, conductor) {
  return design && design.lineModel === 'coupled' && conductor ? parseZMatrix(conductor.zMatrix) : null;
}

/** A diagonal 4×4 matrix from per-km R/X/Rn/Xn (what the simple model uses). @param {{ R: number, X: number, Rn: number, Xn: number }} p */
export function diagonalZMatrix(p) {
  const z = { re: 0, im: 0 };
  return [
    [{ re: p.R, im: p.X }, z, z, z],
    [z, { re: p.R, im: p.X }, z, z],
    [z, z, { re: p.R, im: p.X }, z],
    [z, z, z, { re: p.Rn, im: p.Xn }]
  ];
}
