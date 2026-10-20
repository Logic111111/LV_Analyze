import { describe, it, expect } from 'vitest';
import {
  C, factorComplexSystem, solveFactoredSystem, connectionIndex, netS, topologyOf, bfsOrderFrom,
  runSnapshot, runDailyScan, warmStartFrom, scanAndSummarize
} from '../loadflow.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';
import { syntheticFeeder } from './fixtures/syntheticFeeder.js';

// P1.4 — the speed-ups must not change results: the structural ones are bit-identical (also
// enforced by the 1e-9 reference lock), and warm starts agree with cold starts within 1e-3 V.

// The pre-P1.4 single-pass elimination, verbatim, as the yardstick for the factor-once version.
function singlePassSolve(Y, J) {
  const n = J.length;
  const A = Y.map(row => row.map(v => ({ ...v })));
  const b = J.map(v => ({ ...v }));
  for (let col = 0; col < n; col++) {
    let pivot = col, pivotMag = C.abs(A[col][col]);
    for (let r = col + 1; r < n; r++) { const m = C.abs(A[r][col]); if (m > pivotMag) { pivot = r; pivotMag = m; } }
    if (pivot !== col) { [A[col], A[pivot]] = [A[pivot], A[col]]; [b[col], b[pivot]] = [b[pivot], b[col]]; }
    const diag = A[col][col];
    for (let r = col + 1; r < n; r++) {
      if (A[r][col].re === 0 && A[r][col].im === 0) continue;
      const factor = C.div(A[r][col], diag);
      for (let c = col; c < n; c++) A[r][c] = C.sub(A[r][c], C.mul(factor, A[col][c]));
      b[r] = C.sub(b[r], C.mul(factor, b[col]));
    }
  }
  const x = new Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let sum = b[r];
    for (let c = r + 1; c < n; c++) sum = C.sub(sum, C.mul(A[r][c], x[c]));
    x[r] = C.div(sum, A[r][r]);
  }
  return x;
}

function rng(seed) { let s = seed; return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 - 0.5; }; }

describe('factor-once complex linear solve', () => {
  it('solves a hand-checkable 2×2 system', () => {
    // [2 1; 1 3] x = [3; 5]  →  x = [0.8, 1.4]
    const Y = [[{ re: 2, im: 0 }, { re: 1, im: 0 }], [{ re: 1, im: 0 }, { re: 3, im: 0 }]];
    const x = solveFactoredSystem(factorComplexSystem(Y), [{ re: 3, im: 0 }, { re: 5, im: 0 }]);
    expect(x[0].re).toBeCloseTo(0.8, 14); expect(x[1].re).toBeCloseTo(1.4, 14);
    expect(x[0].im).toBe(0); expect(x[1].im).toBe(0);
  });

  it('is bit-identical to the single-pass elimination, including with pivoting and many RHS', () => {
    const r = rng(7);
    for (const n of [3, 8, 25]) {
      const Y = Array.from({ length: n }, () => Array.from({ length: n }, () => ({ re: r(), im: r() })));
      const f = factorComplexSystem(Y);
      for (let k = 0; k < 4; k++) {
        const J = Array.from({ length: n }, () => ({ re: r() * 100, im: r() * 100 }));
        expect(solveFactoredSystem(f, J)).toEqual(singlePassSolve(Y, J));
      }
    }
  });
});

describe('connection index and topology maps', () => {
  it('netS gives exactly the same injections with a prebuilt index as without', () => {
    const d = syntheticFeeder();
    const index = connectionIndex(d);
    d.poles.forEach(p => {
      expect(netS(d, p.id, 2, 19, 1.1, 0.9, [], [], index)).toEqual(netS(d, p.id, 2, 19, 1.1, 0.9, []));
    });
  });

  it('keeps each pole\'s connections in list order and skips load types the engine does not model', () => {
    const d = walkthroughIsland();
    d.loads.push({ id: 'X1', pole: 'P3', type: 'mystery', phase: 'A', kva: 3 });
    const p3 = connectionIndex(d).get('P3');
    expect(p3.loads.general.map(l => l.id)).toEqual(['L5', 'L12', 'L13', 'L14', 'L15', 'L16', 'L17']);
    expect(p3.loads.ev.map(l => l.id)).toEqual(['L6', 'L18']);
    expect(Object.values(p3.loads).flat().some(l => l.id === 'X1')).toBe(false);
  });

  it('solves poles in the same breadth-first order bfsOrderFrom gives', () => {
    const d = syntheticFeeder();
    const roots = d.poles.filter(p => p.parent === 'TX').map(p => p.id);
    expect(runSnapshot(d, { year: 0, hour: 20 }).poleResults.map(p => p.id)).toEqual(bfsOrderFrom(d, roots));
    const { kidsMap } = topologyOf(d);
    expect(kidsMap.get('TX')).toEqual(roots);
  });
});

describe('phasors in results', () => {
  it('|vph| is exactly the reported |V|, and the bus phasors match busVoltPct', () => {
    const r = runSnapshot(walkthroughIsland(), { year: 0, hour: 20, solarMult: 0 });
    r.poleResults.forEach(p => ['A', 'B', 'C'].forEach(ph => expect(C.abs(p.vph[ph])).toBe(p.volt[ph])));
    ['A', 'B', 'C'].forEach(ph => expect(C.abs(r.transformers[0].busVph[ph])).toBe(r.transformers[0].busVoltPct[ph]));
  });
});

describe('warm starts', () => {
  const maxDv = (a, b) => {
    let m = 0;
    a.forEach((r, i) => r.poleResults.forEach((p, j) => ['A', 'B', 'C'].forEach(ph => { m = Math.max(m, Math.abs(p.volt[ph] - b[i].poleResults[j].volt[ph])); })));
    return m;
  };
  const iters = rows => rows.reduce((s, r) => s + r.iterUsed, 0);

  it.each([
    ['Walkthrough Island', walkthroughIsland],
    ['synthetic 50-pole feeder', () => syntheticFeeder()]
  ])('a warm 24 h scan of the %s matches a cold one within 1e-3 V, same violations, fewer iterations', (_n, build) => {
    const d = build();
    for (const year of [0, 5]) {
      const cold = runDailyScan(d, year, { warmStart: false });
      const warm = runDailyScan(d, year);
      expect(maxDv(cold, warm)).toBeLessThan(1e-3);
      expect(warm.map(r => r.violations.map(v => v.pole + v.phase + v.type))).toEqual(cold.map(r => r.violations.map(v => v.pole + v.phase + v.type)));
      expect(warm.every(r => r.converged)).toBe(true);
      expect(iters(warm)).toBeLessThan(iters(cold));
    }
  });

  it('warmStart:false reproduces single cold snapshots exactly', () => {
    const d = walkthroughIsland();
    const cold = runDailyScan(d, 0, { warmStart: false });
    cold.forEach((r, h) => expect(r).toEqual(runSnapshot(d, { year: 0, hour: h, loadMult: 1, solarMult: 1, extraBess: [] })));
    expect(scanAndSummarize(d, [20, 21], 0, { warmStart: false })).toEqual(scanAndSummarize(d, [20, 21], 0, { warmStart: false }));
  });

  it('a subtree with earth electrodes ignores a warm start (stays bit-identical to cold)', () => {
    const d = syntheticFeeder({ grounded: true });
    const prev = runSnapshot(d, { year: 0, hour: 19 });
    expect(runSnapshot(d, { year: 0, hour: 20 }, { initialV: warmStartFrom(prev) })).toEqual(runSnapshot(d, { year: 0, hour: 20 }));
  });

  it('an unconverged snapshot is never used as a warm start', () => {
    expect(warmStartFrom({ converged: false, poleResults: [], transformers: [] })).toBeNull();
    expect(warmStartFrom(null)).toBeNull();
  });
});
