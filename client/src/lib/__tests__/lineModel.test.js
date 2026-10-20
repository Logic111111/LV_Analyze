import { describe, it, expect } from 'vitest';
import { runSnapshot, conductorParams, diagonalZMatrix, parseZMatrix, runDailyScan, C, defaultDesign } from '../loadflow.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';
import { syntheticFeeder } from './fixtures/syntheticFeeder.js';

// P3.5 — coupled 4×4 line model behind design.lineModel = 'coupled'.

function withDiagonalMatrices(d) {
  const lib = { ...d.conductorLibrary };
  Object.keys(lib).forEach(code => { lib[code] = { ...lib[code], zMatrix: diagonalZMatrix(conductorParams(d, code)) }; });
  return { ...d, lineModel: 'coupled', conductorLibrary: lib };
}

describe('diagonal matrices from today\'s values reproduce the simple model exactly', () => {
  it.each([
    ['Walkthrough Island, 20:00', walkthroughIsland, { year: 0, hour: 20, solarMult: 0 }],
    ['Walkthrough Island, 12:00 ×1.5 solar', walkthroughIsland, { year: 0, hour: 12, solarMult: 1.5 }],
    ['synthetic 50-pole feeder, 20:00', () => syntheticFeeder(), { year: 0, hour: 20 }]
  ])('%s', (_n, build, opts) => {
    const d = build();
    const coupled = runSnapshot(withDiagonalMatrices(d), opts);
    const simple = runSnapshot(d, opts);
    const { lineModel, couplingIgnored, ...rest } = coupled;
    expect(lineModel).toBe('coupled');
    expect(couplingIgnored).toEqual([]);
    expect(rest).toEqual(simple);
  });

  it('a full day too', () => {
    const d = walkthroughIsland();
    const a = runDailyScan(withDiagonalMatrices(d), 0, { warmStart: false }).map(({ lineModel, couplingIgnored, ...r }) => r);
    expect(a).toEqual(runDailyScan(d, 0, { warmStart: false }));
  });

  it('without the flag, matrices are ignored', () => {
    const d = { ...withDiagonalMatrices(walkthroughIsland()), lineModel: 'simple' };
    d.conductorLibrary['50ABC'].zMatrix[0][1] = { re: 0.1, im: 0.1 }; // would change results if used
    expect(runSnapshot(d, { year: 0, hour: 20, solarMult: 0 })).toEqual(runSnapshot(walkthroughIsland(), { year: 0, hour: 20, solarMult: 0 }));
  });
});

describe('mutual coupling', () => {
  // One pole, 100 m, a balanced 3-phase load: no neutral current, so each phase sees Zs − Zm.
  function onePole(zMatrix) {
    const d = defaultDesign();
    d.transformers = [{ ...d.transformers[0], txRating: 630 }];
    d.poles = [{ id: 'P1', feeder: 'F1', parent: 'TX', spanM: 100, cond: 'TEST', grounded: false, groundOhms: 20 }];
    d.loads = [{ id: 'L1', pole: 'P1', type: 'general', phase: 'ABC', kva: 30 }];
    d.pv = []; d.lineModel = 'coupled';
    d.conductorLibrary = { ...d.conductorLibrary, TEST: { R: 0.5, X: 0.1, neutralScale: 1, I: 400, zMatrix } };
    return d;
  }
  const zs = { re: 0.5, im: 0.30 }, zm = { re: 0.05, im: 0.20 }, zn = { re: 0.5, im: 0.3 };
  // Test-only matrix (Ω/km): symmetric, equal self and mutual terms.
  const M = [[zs, zm, zm, zm], [zm, zs, zm, zm], [zm, zm, zs, zm], [zm, zm, zm, zn]];

  it('a balanced load drops (Zs − Zm)·I per phase', () => {
    const r = runSnapshot(onePole(parseZMatrix(M)), { year: 0, hour: 20 });
    expect(r.converged).toBe(true);
    const bus = r.transformers[0].busVph.A, p1 = r.poleResults[0];
    const I = C.div(C.sub(bus, p1.vph.A), { re: (zs.re - zm.re) * 0.1, im: (zs.im - zm.im) * 0.1 });
    // Agreement to the solver's own stopping tolerance (|ΔV| < 1e-4 V over a 0.046 Ω loop ≈ 2 mA).
    expect(C.abs(I)).toBeCloseTo(p1.cur.A, 2);
    expect(p1.In).toBeLessThan(1e-6);
  });

  it('coupling changes results relative to the self-impedance-only model', () => {
    const coupled = runSnapshot(onePole(parseZMatrix(M)), { year: 0, hour: 20 });
    const selfOnly = runSnapshot(onePole(parseZMatrix(M.map((row, k) => row.map((z, j) => (k === j ? z : { re: 0, im: 0 }))))), { year: 0, hour: 20 });
    expect(Math.abs(coupled.poleResults[0].volt.A - selfOnly.poleResults[0].volt.A)).toBeGreaterThan(0.05);
  });

  it('parses [re, im] pairs and rejects malformed matrices', () => {
    expect(parseZMatrix([[[1, 2], [0, 0], [0, 0], [0, 0]], [[0, 0], [1, 2], [0, 0], [0, 0]], [[0, 0], [0, 0], [1, 2], [0, 0]], [[0, 0], [0, 0], [0, 0], [3, 4]]])[3][3]).toEqual({ re: 3, im: 4 });
    expect(parseZMatrix([[1]])).toBeNull();
  });

  it('a subtree with an earth electrode keeps the uncoupled model and says so', () => {
    const d = withDiagonalMatrices(walkthroughIsland());
    d.poles = d.poles.map(p => (p.id === 'P3' ? { ...p, grounded: true, groundOhms: 20 } : p));
    expect(runSnapshot(d, { year: 0, hour: 20, solarMult: 0 }).couplingIgnored).toEqual(['P1', 'P2', 'P3']);
  });
});
