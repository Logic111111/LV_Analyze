import { expect } from 'vitest';

// Golden tolerance, per the brief: "±0.01 on the stated decimals unless noted". A value stated to
// 2+ decimals is held to ±0.01; one stated to 1 decimal is held to ±0.05 (half a unit in the last
// stated place — it must still round to the figure in the table); 0 decimals → ±0.5.
export function tolForDecimals(dp) {
  return dp >= 2 ? 0.01 : 0.5 * Math.pow(10, -dp);
}

// expectGolden(actual, 225.532, 3, 'P1 V-A') — `dp` is how many decimals the golden table states.
// Pass an explicit `tol` (5th arg) where the brief gives one, e.g. "3063.4 W (±0.5)".
export function expectGolden(actual, expected, dp, label = '', tol = tolForDecimals(dp)) {
  const msg = `${label}: expected ${expected} ±${tol}, got ${actual}`;
  expect(Number.isFinite(actual), msg).toBe(true);
  expect(Math.abs(actual - expected), msg).toBeLessThanOrEqual(tol + 1e-12);
}

export function poleResult(res, id) {
  const p = res.poleResults.find(pr => pr.id === id);
  if (!p) throw new Error('no pole result for ' + id);
  return p;
}

// Lowest phase-neutral voltage anywhere, across every snapshot in a scan.
export function minVoltage(snapshots) {
  let min = Infinity;
  snapshots.forEach(r => r.poleResults.forEach(p => ['A', 'B', 'C'].forEach(ph => { if (p.volt[ph] < min) min = p.volt[ph]; })));
  return min;
}

// Returns a copy of `design` with every transformer set to `tap`.
export function withTap(design, tap) {
  return { ...design, transformers: design.transformers.map(t => ({ ...t, tap })) };
}

// Asserts every number in `expected` (a JSON-plain reference) is matched by `actual` to within
// `tol`, recursing through objects/arrays. Keys only present in `actual` are allowed — later phases
// add new result fields (phasors, VUF, …) and that must not break the lock; only drift in what was
// already there does. Returns the list of mismatches (empty = pass) so the caller can print them all.
export function diffReference(expected, actual, tol = 1e-9, path = '') {
  const out = [];
  if (typeof expected === 'number') {
    if (typeof actual !== 'number' || !(Math.abs(actual - expected) <= tol)) out.push(`${path}: expected ${expected}, got ${actual}`);
    return out;
  }
  if (expected === null || typeof expected !== 'object') {
    if (actual !== expected) out.push(`${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    return out;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      out.push(`${path}: expected array of length ${expected.length}, got ${Array.isArray(actual) ? 'length ' + actual.length : typeof actual}`);
      return out;
    }
    expected.forEach((e, i) => out.push(...diffReference(e, actual[i], tol, `${path}[${i}]`)));
    return out;
  }
  if (actual === null || typeof actual !== 'object') { out.push(`${path}: expected object, got ${JSON.stringify(actual)}`); return out; }
  Object.keys(expected).forEach(k => out.push(...diffReference(expected[k], actual[k], tol, path ? `${path}.${k}` : k)));
  return out;
}
