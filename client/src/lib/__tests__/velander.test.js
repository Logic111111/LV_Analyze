import { describe, it, expect } from 'vitest';
import { fitVelander, parseVelanderCsv, velanderPeakKva, basePeakKva, runSnapshot, runDailyScan, withDefaults } from '../loadflow.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';

// P6.2 — Velander.

describe('fit', () => {
  it('recovers k1, k2 exactly from noise-free data (test-only constants), R² = 1', () => {
    const k1 = 0.00029, k2 = 0.15; // test-only, not defaults
    const pairs = [600, 1200, 2400, 3600, 6000].map(W => ({ annualKWh: W, peakKw: k1 * W + k2 * Math.sqrt(W) }));
    const f = fitVelander(pairs);
    expect(f.k1).toBeCloseTo(k1, 12);
    expect(f.k2).toBeCloseTo(k2, 12);
    expect(f.r2).toBeCloseTo(1, 12);
    f.residuals.forEach(r => expect(Math.abs(r.residualKw)).toBeLessThan(1e-12));
  });
  it('matches the normal-equation solution on noisy data, and R² < 1', () => {
    const pairs = [{ annualKWh: 800, peakKw: 4.9 }, { annualKWh: 1500, peakKw: 6.6 }, { annualKWh: 2500, peakKw: 8.4 }, { annualKWh: 4000, peakKw: 10.9 }];
    const f = fitVelander(pairs);
    // residuals are orthogonal to both basis columns at the least-squares optimum
    const dotW = f.residuals.reduce((s, r) => s + r.residualKw * r.annualKWh, 0);
    const dotS = f.residuals.reduce((s, r) => s + r.residualKw * Math.sqrt(r.annualKWh), 0);
    expect(Math.abs(dotW)).toBeLessThan(1e-6);
    expect(Math.abs(dotS)).toBeLessThan(1e-6);
    expect(f.r2).toBeGreaterThan(0.9);
    expect(f.r2).toBeLessThan(1);
  });
  it('refuses too few points or identical energies', () => {
    expect(fitVelander([{ annualKWh: 1000, peakKw: 5 }]).error).toMatch(/at least two/);
    expect(fitVelander([{ annualKWh: 1000, peakKw: 5 }, { annualKWh: 1000, peakKw: 6 }]).error).toMatch(/all the same/);
  });
  it('parses CSV with a header, mixed separators, and reports bad lines', () => {
    const { pairs, errors } = parseVelanderCsv('annual_kwh,peak_kw\n1200,5.1\n2400;7.2\n3600\t9\nbad,line\n');
    expect(pairs).toEqual([{ annualKWh: 1200, peakKw: 5.1 }, { annualKWh: 2400, peakKw: 7.2 }, { annualKWh: 3600, peakKw: 9 }]);
    expect(errors).toEqual(['Line 5: "bad,line" is not two numbers']);
  });
});

describe('in the load flow', () => {
  it('off by default: annual kWh alone changes nothing; old designs get it off with no constants', () => {
    const d = walkthroughIsland();
    const withKwh = { ...d, loads: d.loads.map(l => (l.type === 'general' ? { ...l, annualKWh: 2400 } : l)) };
    expect(runDailyScan(withKwh, 0)).toEqual(runDailyScan(d, 0));
    expect(withDefaults(walkthroughIsland()).velander).toEqual({ enabled: false, k1: null, k2: null });
  });
  it('on: a blank-kVA general load with annual kWh uses (k1·W + k2·√W)/pf; entered kVA and other types are untouched', () => {
    const d = { ...walkthroughIsland(), velander: { enabled: true, k1: 0.0003, k2: 0.12 } };
    const W = 2400, peak = (0.0003 * W + 0.12 * Math.sqrt(W)) / d.pf;
    expect(velanderPeakKva(d, W)).toBeCloseTo(peak, 12);
    expect(basePeakKva(d, { id: 'x', pole: 'P1', type: 'general', phase: 'A', kva: null, annualKWh: W })).toBeCloseTo(peak, 12);
    expect(basePeakKva(d, { id: 'x', pole: 'P1', type: 'general', phase: 'A', kva: 3, annualKWh: W })).toBe(3);
    expect(basePeakKva(d, { id: 'x', pole: 'P1', type: 'general', phase: 'A', kva: null })).toBe(d.admd);
    const withKwh = { ...d, loads: d.loads.map(l => (l.type === 'general' && l.kva == null ? { ...l, annualKWh: W } : l)) };
    const a = runSnapshot(withKwh, { year: 0, hour: 20 }), b = runSnapshot(d, { year: 0, hour: 20 });
    expect(a.transformers[0].txKVA).not.toBeCloseTo(b.transformers[0].txKVA, 3);
  });
});
