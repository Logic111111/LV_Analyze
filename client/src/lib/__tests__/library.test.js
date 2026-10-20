import { describe, it, expect } from 'vitest';
import {
  CONDUCTORS, TRANSFORMERS, defaultDesign, withDefaults, getConductor, getTransformerType, conductorCodes,
  transformerRatings, conductorParams, condX, condRn, condXn, txImpedance, runSnapshot, scanAndSummarize
} from '../loadflow.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';
import { poleResult } from './helpers.js';

// P1.2 — every engine lookup of conductor/transformer data goes through the design's own library
// (seeded with exact copies of the built-ins), falling back to the built-ins.

const NIGHT = { year: 0, hour: 20, solarMult: 0 };
function withoutLibraries(d) {
  const { conductorLibrary, transformerLibrary, ...rest } = d;
  return rest;
}

describe('built-in libraries', () => {
  it('are exactly the pre-existing entries', () => {
    expect(CONDUCTORS).toEqual({
      '70ABC': { R: 0.443, L_mH: 0.3, Z: 0.453, I: 203, neutralScale: 70 / 50 },
      '50ABC': { R: 0.641, L_mH: 0.3, Z: 0.647, I: 162, neutralScale: 50 / 35 }
    });
    expect(TRANSFORMERS).toEqual({
      100: { kVA: 100, z: 0.04, noLoadW: 260 }, 160: { kVA: 160, z: 0.04, noLoadW: 380 },
      250: { kVA: 250, z: 0.04, noLoadW: 530 }, 630: { kVA: 630, z: 0.04, noLoadW: 1200 }
    });
  });

  it('are frozen, so a design edit can never leak into them', () => {
    expect(Object.isFrozen(CONDUCTORS)).toBe(true);
    expect(Object.isFrozen(CONDUCTORS['70ABC'])).toBe(true);
    expect(Object.isFrozen(TRANSFORMERS[100])).toBe(true);
  });

  it('condX/condRn/condXn without a design keep their original values', () => {
    expect(condX('70ABC')).toBe(Math.sqrt(0.453 * 0.453 - 0.443 * 0.443));
    expect(condRn('50ABC')).toBe(0.641 * (50 / 35));
    expect(condXn('50ABC')).toBe(condX('50ABC'));
  });
});

describe('design libraries', () => {
  it('a new design carries deep copies of the built-ins', () => {
    const d = defaultDesign();
    expect(d.conductorLibrary).toEqual(CONDUCTORS);
    expect(d.transformerLibrary).toEqual({ ...TRANSFORMERS });
    expect(d.conductorLibrary['70ABC']).not.toBe(CONDUCTORS['70ABC']);
    d.conductorLibrary['70ABC'].R = 99;
    expect(CONDUCTORS['70ABC'].R).toBe(0.443);
  });

  it('withDefaults adds them to a design saved before libraries existed', () => {
    const out = withDefaults(withoutLibraries(walkthroughIsland()));
    expect(out.conductorLibrary).toEqual(CONDUCTORS);
    expect(out.transformerLibrary).toEqual({ ...TRANSFORMERS });
  });

  it('a design with no library gives bit-identical results to one with the default copy', () => {
    const withLib = walkthroughIsland();
    expect(runSnapshot(withoutLibraries(withLib), NIGHT)).toEqual(runSnapshot(withLib, NIGHT));
    expect(scanAndSummarize(withoutLibraries(withLib))).toEqual(scanAndSummarize(withLib));
  });

  it('the solver reads the design library, not the built-ins', () => {
    const d = walkthroughIsland();
    // A lower-resistance 50ABC in this design's library must raise P3-A (the 50ABC span) at night peak.
    const better = { ...d, conductorLibrary: { ...d.conductorLibrary, '50ABC': { ...d.conductorLibrary['50ABC'], R: 0.5 } } };
    const base = poleResult(runSnapshot(d, NIGHT), 'P3').volt.A;
    expect(poleResult(runSnapshot(better, NIGHT), 'P3').volt.A).toBeGreaterThan(base + 0.5);
  });

  it('a code missing from the design library falls back to the built-in entry', () => {
    const d = { ...walkthroughIsland(), conductorLibrary: {} };
    expect(getConductor(d, '50ABC')).toBe(CONDUCTORS['50ABC']);
    expect(runSnapshot(d, NIGHT)).toEqual(runSnapshot(walkthroughIsland(), NIGHT));
  });

  it('an unknown conductor or rating is a clear error, not a TypeError deep in the solver', () => {
    expect(() => getConductor(walkthroughIsland(), 'NOPE')).toThrow(/Unknown conductor "NOPE"/);
    expect(() => getTransformerType(walkthroughIsland(), 999)).toThrow(/Unknown transformer rating "999"/);
    const bad = walkthroughIsland();
    bad.poles[2] = { ...bad.poles[2], cond: 'NOPE' };
    expect(() => runSnapshot(bad, NIGHT)).toThrow(/Unknown conductor "NOPE"/);
  });

  it('an entry may give X, Rn, Xn explicitly instead of |Z| and a neutral scale', () => {
    const p = conductorParams(null, '50ABC');
    const d = walkthroughIsland();
    const explicit = {
      ...d,
      conductorLibrary: { ...d.conductorLibrary, '50ABC': { R: p.R, X: p.X, Rn: p.Rn, Xn: p.Xn, I: p.I, Z: 0, neutralScale: 0 } }
    };
    expect(conductorParams(explicit, '50ABC')).toEqual(p);
    expect(runSnapshot(explicit, NIGHT)).toEqual(runSnapshot(d, NIGHT));
  });

  it('a user-added conductor can be used on a span', () => {
    const d = walkthroughIsland();
    const custom = {
      ...d,
      conductorLibrary: { ...d.conductorLibrary, TEST: { ...d.conductorLibrary['70ABC'] } },
      poles: d.poles.map(p => p.id === 'P3' ? { ...p, cond: 'TEST' } : p)
    };
    const same70 = { ...d, poles: d.poles.map(p => p.id === 'P3' ? { ...p, cond: '70ABC' } : p) };
    expect(conductorCodes(custom)).toEqual(['70ABC', '50ABC', 'TEST']);
    // Same data under a new code → same voltages (only the pole's `cond` label differs).
    expect(runSnapshot(custom, NIGHT).poleResults.map(pr => pr.volt)).toEqual(runSnapshot(same70, NIGHT).poleResults.map(pr => pr.volt));
  });

  it('a user-added transformer rating drives loading %, impedance and no-load loss', () => {
    const d = walkthroughIsland();
    const lib = { ...d.transformerLibrary, 200: { kVA: 200, z: 0.045, noLoadW: 450 } };
    const { txNoLoadW, ...noOverride } = d; // the per-rating no-load table has no 200 kVA row
    const custom = { ...noOverride, transformerLibrary: lib, transformers: [{ ...d.transformers[0], txRating: 200 }] };
    expect(transformerRatings(custom)).toEqual([100, 160, 200, 250, 630]);
    const t = runSnapshot(custom, NIGHT).transformers[0];
    expect(t.txPct).toBeCloseTo(t.txKVA / 200 * 100, 12);
    expect(t.txNoLoadW).toBe(450);
    expect(txImpedance(custom.transformers[0], custom).z).toBeCloseTo(0.045 * 415 * 415 / 200000, 12);
  });

  it('the per-rating no-load override (design.txNoLoadW) still wins over the library', () => {
    const d = { ...walkthroughIsland(), txNoLoadW: { ...walkthroughIsland().txNoLoadW, 100: 300 } };
    expect(runSnapshot(d, NIGHT).transformers[0].txNoLoadW).toBe(300);
  });
});
