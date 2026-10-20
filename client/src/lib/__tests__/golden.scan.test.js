import { describe, it, expect } from 'vitest';
import { scanAndSummarize, dailyEnergyLossKwh, runDailyScan, runSnapshot, secondaryLNVoltage } from '../loadflow.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';
import { balancedIsland } from './fixtures/referenceCases.js';
import { expectGolden, minVoltage, poleResult, withTap } from './helpers.js';

// Phase 0 golden table — 24-hour scans, tap sweeps and the P3 reconductor case.

describe('golden: 24-hour scans (year 0)', () => {
  it('unbalanced scanAndSummarize: 3 voltage violations, 19.156 kWh', () => {
    const s = scanAndSummarize(walkthroughIsland());
    expect(s.voltageViolationCount).toBe(3);
    expectGolden(s.lossKwh, 19.156, 3, 'daily kWh');
  });

  it('unbalanced dailyEnergyLossKwh: line 10.778, transformer 8.377, total 19.156', () => {
    const e = dailyEnergyLossKwh(walkthroughIsland());
    expectGolden(e.lineKwh, 10.778, 3, 'line kWh');
    expectGolden(e.txKwh, 8.377, 3, 'transformer kWh');
    expectGolden(e.totalKwh, 19.156, 3, 'total kWh');
  });

  it('balanced: 0 voltage violations, 13.288 kWh', () => {
    const s = scanAndSummarize(balancedIsland());
    expect(s.voltageViolationCount).toBe(0);
    expectGolden(s.lossKwh, 13.288, 3, 'daily kWh');
  });
});

describe('golden: tap sweep, unbalanced (24 h, year 0)', () => {
  const cases = [
    [1, 229.51, 10, 19.90], [2, 235.24, 3, 19.16], [3, 241.28, 15, 18.44], [4, 247.63, 166, 17.75]
  ];
  it.each(cases)('tap %i: V0 %f, %i violations, %f kWh', (tap, v0, viol, kwh) => {
    const d = withTap(walkthroughIsland(), tap);
    expectGolden(secondaryLNVoltage(d.transformers[0]), v0, 2, `tap ${tap} V0`);
    const s = scanAndSummarize(d);
    expect(s.voltageViolationCount).toBe(viol);
    expectGolden(s.lossKwh, kwh, 2, `tap ${tap} kWh`);
  });
});

describe('golden: tap sweep, balanced', () => {
  it.each([[1, 0], [2, 0], [3, 15], [4, 174]])('tap %i: %i voltage violations', (tap, viol) => {
    expect(scanAndSummarize(withTap(balancedIsland(), tap)).voltageViolationCount).toBe(viol);
  });

  it('tap 1 13.66 kWh vs tap 2 13.29 kWh', () => {
    expectGolden(scanAndSummarize(withTap(balancedIsland(), 1)).lossKwh, 13.66, 2, 'tap 1 kWh');
    expectGolden(scanAndSummarize(withTap(balancedIsland(), 2)).lossKwh, 13.29, 2, 'tap 2 kWh');
  });

  it('year-5 minimum voltage: tap 1 217.29 V, tap 2 223.36 V', () => {
    expectGolden(minVoltage(runDailyScan(withTap(balancedIsland(), 1), 5)), 217.29, 2, 'tap 1 year-5 min V');
    expectGolden(minVoltage(runDailyScan(withTap(balancedIsland(), 2), 5)), 223.36, 2, 'tap 2 year-5 min V');
  });
});

describe('golden: P3 span 50ABC → 70ABC (unbalanced)', () => {
  const d = walkthroughIsland();
  const upgraded = { ...d, poles: d.poles.map(p => p.id === 'P3' ? { ...p, cond: '70ABC' } : p) };

  it('24 h: 2 voltage violations, 18.10 kWh', () => {
    const s = scanAndSummarize(upgraded);
    expect(s.voltageViolationCount).toBe(2);
    expectGolden(s.lossKwh, 18.10, 2, 'daily kWh');
  });

  it('P3-A at 20:00 is 214.84 V', () => {
    expectGolden(poleResult(runSnapshot(upgraded, { year: 0, hour: 20, solarMult: 0 }), 'P3').volt.A, 214.84, 2, 'P3 V-A');
  });
});
