import { describe, it, expect } from 'vitest';
import { runSnapshot, runDailyScan, hvMultiplierAt, secondaryLNVoltage } from '../loadflow.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';

// P3.4 — HV voltage profile.

describe('HV voltage profile', () => {
  it('absent, all 1.0, or invalid entries mean 1.0', () => {
    expect(hvMultiplierAt({}, 5)).toBe(1);
    expect(hvMultiplierAt({ hvProfile: Array(24).fill(1) }, 5)).toBe(1);
    expect(hvMultiplierAt({ hvProfile: [0.98, 'x', -1] }, 1)).toBe(1);
    expect(hvMultiplierAt({ hvProfile: [0.98] }, 0)).toBe(0.98);
  });

  it('an all-1.0 profile gives bit-identical results (goldens unchanged)', () => {
    const d = walkthroughIsland();
    const flat = { ...d, transformers: d.transformers.map(t => ({ ...t, hvProfile: Array(24).fill(1) })) };
    expect(runDailyScan(flat, 0, { warmStart: false })).toEqual(runDailyScan(d, 0, { warmStart: false }).map(r => r));
  });

  it('scales the source EMF at the hours it is set for, and nowhere else', () => {
    const d = walkthroughIsland();
    const prof = Array(24).fill(1); prof[20] = 1.02;
    const withProf = { ...d, transformers: d.transformers.map(t => ({ ...t, hvProfile: prof })) };
    const at20 = runSnapshot(withProf, { year: 0, hour: 20, solarMult: 0 }).transformers[0];
    expect(at20.V0).toBeCloseTo(secondaryLNVoltage(d.transformers[0]) * 1.02, 12);
    expect(at20.hvMultiplier).toBe(1.02);
    const base20 = runSnapshot(d, { year: 0, hour: 20, solarMult: 0 }).transformers[0];
    expect(at20.busVoltPct.A).toBeGreaterThan(base20.busVoltPct.A + 3);
    expect(runSnapshot(withProf, { year: 0, hour: 19 })).toEqual(runSnapshot(d, { year: 0, hour: 19 }));
  });
});
