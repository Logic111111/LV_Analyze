import { describe, it, expect } from 'vitest';
import { runSnapshot, systemLossW } from '../loadflow.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';
import { expectGolden, poleResult } from './helpers.js';

// Phase 0 golden table — single snapshots on the unbalanced Walkthrough Island. Every value here
// matches the hand-calculation workbook. These must never change (brief rule 1).

describe('golden: Walkthrough Island, year 0, 20:00, no solar', () => {
  const res = runSnapshot(walkthroughIsland(), { year: 0, hour: 20, solarMult: 0 });

  it('converges in 21 iterations (cold start)', () => {
    expect(res.converged).toBe(true);
    expect(res.iterUsed).toBe(21);
  });

  it.each([
    ['P1', 225.532, 235.710, 234.490],
    ['P2', 218.848, 237.567, 235.198],
    ['P3', 212.863, 239.197, 235.574]
  ])('voltages at %s', (id, a, b, c) => {
    const p = poleResult(res, id);
    expectGolden(p.volt.A, a, 3, `${id} V-A`);
    expectGolden(p.volt.B, b, 3, `${id} V-B`);
    expectGolden(p.volt.C, c, 3, `${id} V-C`);
  });

  it.each([
    ['P1', 121.297, 12.634, 34.606, 97.849],
    ['P3', 73.522, 6.271, 28.229, 57.865]
  ])('span currents at %s', (id, a, b, c, n) => {
    const p = poleResult(res, id);
    expectGolden(p.cur.A, a, 3, `${id} I-A`);
    expectGolden(p.cur.B, b, 3, `${id} I-B`);
    expectGolden(p.cur.C, c, 3, `${id} I-C`);
    expectGolden(p.In, n, 3, `${id} I-N`);
  });

  it('transformer loading, import and LV bus voltages', () => {
    const t = res.transformers[0];
    expectGolden(t.txKVA, 38.974, 3, 'TX kVA');
    expectGolden(t.txPct, 38.97, 2, 'TX %');
    expect(t.flowDirection).toBe('import');
    expectGolden(t.netKW, 37.103, 3, 'TX import kW');
    expectGolden(t.busVoltPct.A, 230.172, 3, 'bus V-A');
    expectGolden(t.busVoltPct.B, 234.710, 3, 'bus V-B');
    expectGolden(t.busVoltPct.C, 233.879, 3, 'bus V-C');
  });

  it('losses: line, transformer copper, total including 260 W no-load', () => {
    const t = res.transformers[0];
    expectGolden(res.totalLossW, 1668.49, 2, 'line loss W');
    expectGolden(t.txLossW, 350.09, 2, 'TX copper loss W');
    expect(t.txNoLoadW).toBe(260);
    expectGolden(systemLossW(res).totalLossW, 2278.58, 2, 'total loss W');
  });

  it('has exactly one violation: P3 A undervoltage 212.86 V', () => {
    expect(res.violations).toHaveLength(1);
    expect(res.violations[0]).toMatchObject({ pole: 'P3', phase: 'A', type: 'undervoltage' });
    expectGolden(res.violations[0].value, 212.86, 2, 'P3 A undervoltage');
  });
});

describe('golden: year 5, 20:00, no solar', () => {
  const res = runSnapshot(walkthroughIsland(), { year: 5, hour: 20, solarMult: 0 });

  it('undervoltage at P2 A and P3 A only', () => {
    expect(res.violations.map(v => [v.pole, v.phase, v.type])).toEqual([
      ['P2', 'A', 'undervoltage'], ['P3', 'A', 'undervoltage']
    ]);
    expectGolden(res.violations[0].value, 215.89, 2, 'P2 A');
    expectGolden(res.violations[1].value, 208.82, 2, 'P3 A');
  });

  it('transformer 45.57 % and total loss 3063.4 W (±0.5)', () => {
    expectGolden(res.transformers[0].txPct, 45.57, 2, 'TX %');
    expectGolden(systemLossW(res).totalLossW, 3063.4, 1, 'total loss W', 0.5);
  });
});

describe('golden: 12:00 with solar', () => {
  it('solar 1.0: no violations, importing 2.74 kW, P3 voltages', () => {
    const res = runSnapshot(walkthroughIsland(), { year: 0, hour: 12, solarMult: 1 });
    expect(res.violations).toHaveLength(0);
    expect(res.transformers[0].flowDirection).toBe('import');
    expectGolden(res.transformers[0].netKW, 2.74, 2, 'import kW');
    const p3 = poleResult(res, 'P3');
    expectGolden(p3.volt.A, 229.30, 2, 'P3 V-A');
    expectGolden(p3.volt.B, 239.94, 2, 'P3 V-B');
    expectGolden(p3.volt.C, 234.38, 2, 'P3 V-C');
  });

  it('solar 1.5: exporting, net −1.69 kW, P3-B 241.85 V', () => {
    const res = runSnapshot(walkthroughIsland(), { year: 0, hour: 12, solarMult: 1.5 });
    expect(res.transformers[0].flowDirection).toBe('export');
    expectGolden(res.transformers[0].netKW, -1.69, 2, 'net kW');
    expectGolden(poleResult(res, 'P3').volt.B, 241.85, 2, 'P3 V-B');
  });
});
