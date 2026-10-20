// @ts-check
// Complex arithmetic and the small dense complex linear solver. No imports — everything else in
// the engine builds on this.
/** @import { Complex } from './types.js' */

/* ============================================================
   COMPLEX NUMBER HELPERS
============================================================ */
/** @type {{ add: (a: Complex, b: Complex) => Complex, sub: (a: Complex, b: Complex) => Complex, mul: (a: Complex, b: Complex) => Complex, mulS: (a: Complex, s: number) => Complex, conj: (a: Complex) => Complex, abs: (a: Complex) => number, div: (a: Complex, b: Complex) => Complex, fromPolar: (mag: number, deg: number) => Complex, zero: () => Complex }} */
export const C = {
  add: (a, b) => ({ re: a.re + b.re, im: a.im + b.im }),
  sub: (a, b) => ({ re: a.re - b.re, im: a.im - b.im }),
  mul: (a, b) => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re }),
  mulS: (a, s) => ({ re: a.re * s, im: a.im * s }),
  conj: (a) => ({ re: a.re, im: -a.im }),
  abs: (a) => Math.hypot(a.re, a.im),
  div: (a, b) => { const d = b.re * b.re + b.im * b.im; return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d }; },
  fromPolar: (mag, deg) => ({ re: mag * Math.cos(deg * Math.PI / 180), im: mag * Math.sin(deg * Math.PI / 180) }),
  zero: () => ({ re: 0, im: 0 })
};
/** @type {import('./types.js').Phase[]} */
export const PHASES = ['A', 'B', 'C'];
/** Source EMF angle per phase, degrees (positive sequence A → B → C). */
export const PHASE_ANGLE = { A: 0, B: -120, C: 120 };

// Gaussian elimination with partial pivoting over a complex N×N system Y·x = J. Used only for
// the neutral/ground nodal-admittance solve below — small N (poles per transformer subtree), so
// this direct method is plenty fast without needing a sparse/iterative solver.
/**
 * @param {Complex[][]} Y
 * @param {Complex[]} J
 * @returns {Complex[]}
 */
export function solveComplexLinearSystem(Y, J) {
  return solveFactoredSystem(factorComplexSystem(Y), J);
}

// The same elimination, split in two so a matrix that stays fixed while only the right-hand side
// changes — the neutral admittance matrix across every iteration of one load-flow solve — is
// eliminated once (O(n³)) instead of on every iteration, leaving O(n²) per right-hand side.
// factorComplexSystem records exactly what the elimination does to the right-hand side (each
// column's pivot swap and its row multipliers, in order); solveFactoredSystem replays those steps
// on b in the same sequence and then back-substitutes, so solveComplexLinearSystem's result is
// bit-for-bit what the single-pass version produced.
/**
 * @typedef {object} FactoredSystem
 * @property {Complex[][]} U Upper-triangular matrix after elimination.
 * @property {{ pivot: number, rows: { r: number, factor: Complex }[] }[]} steps One per column.
 */
/** @param {Complex[][]} Y @returns {FactoredSystem} */
export function factorComplexSystem(Y) {
  const n = Y.length;
  const A = Y.map(row => row.map(v => ({ ...v })));
  const steps = [];
  for (let col = 0; col < n; col++) {
    let pivot = col, pivotMag = C.abs(A[col][col]);
    for (let r = col + 1; r < n; r++) {
      const m = C.abs(A[r][col]);
      if (m > pivotMag) { pivot = r; pivotMag = m; }
    }
    if (pivot !== col) { [A[col], A[pivot]] = [A[pivot], A[col]]; }
    const diag = A[col][col];
    const rows = [];
    for (let r = col + 1; r < n; r++) {
      if (A[r][col].re === 0 && A[r][col].im === 0) continue;
      const factor = C.div(A[r][col], diag);
      for (let c = col; c < n; c++) A[r][c] = C.sub(A[r][c], C.mul(factor, A[col][c]));
      rows.push({ r, factor });
    }
    steps.push({ pivot, rows });
  }
  return { U: A, steps };
}

/** @param {FactoredSystem} f @param {Complex[]} J @returns {Complex[]} */
export function solveFactoredSystem(f, J) {
  const { U, steps } = f;
  const n = J.length;
  const b = J.map(v => ({ ...v }));
  for (let col = 0; col < n; col++) {
    const { pivot, rows } = steps[col];
    if (pivot !== col) { [b[col], b[pivot]] = [b[pivot], b[col]]; }
    for (const { r, factor } of rows) b[r] = C.sub(b[r], C.mul(factor, b[col]));
  }
  const x = new Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let sum = b[r];
    for (let c = r + 1; c < n; c++) sum = C.sub(sum, C.mul(U[r][c], x[c]));
    x[r] = C.div(sum, U[r][r]);
  }
  return x;
}
