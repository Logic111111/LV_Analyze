import { describe, it, expect } from 'vitest';
import { tapAdvisor } from '../loadflow.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';
import { balancedIsland } from './fixtures/referenceCases.js';
import { expectGolden } from './helpers.js';

// P2.4 — tap advisor, on the brief's goldens (years 0 and 5, full day).

describe('golden: tap advisor, unbalanced Walkthrough Island', () => {
  const r = tapAdvisor(walkthroughIsland(), 'TX');

  it('scans taps 1–4 with the tap-sweep goldens for year 0', () => {
    expect(r.byTap.map(t => t.tap)).toEqual([1, 2, 3, 4]);
    [229.51, 235.24, 241.28, 247.63].forEach((v, i) => expectGolden(r.byTap[i].noLoadV, v, 2, `tap ${i + 1} V0`));
    expect(r.byTap.map(t => t.violationsByYear[0])).toEqual([10, 3, 15, 166]);
    [19.90, 19.16, 18.44, 17.75].forEach((k, i) => expectGolden(r.byTap[i].kwhYear0, k, 2, `tap ${i + 1} kWh`));
  });

  it('recommends tap 2, diagnosing that unbalance limits what any tap can do', () => {
    expect(r.recommendedTap).toBe(2);
    expect(r.ranked[0].totalViolations).toBeGreaterThan(0);
    expect(r.diagnosis.kind).toBe('unbalance');
    expect(r.ranked[0].worstHourSpread.value).toBeGreaterThan(r.bandWidthV);
    expect(r.diagnosis.message).toMatch(/Balance the phases first/);
  });

  it('carries the off-load note', () => {
    expect(r.note).toMatch(/Off-load/);
    expect(r.currentTap).toBe(2);
  });
});

describe('golden: tap advisor, balanced island', () => {
  const r = tapAdvisor(balancedIsland(), 'TX');
  const t = (n) => r.byTap.find(x => x.tap === n);

  it('recommends tap 2: no violations in years 0 and 5, a wider margin and lower loss than tap 1', () => {
    expect(r.recommendedTap).toBe(2);
    expect(r.diagnosis).toBeNull();
    expect(t(2).violationsByYear).toEqual({ 0: 0, 5: 0 });
    expect(t(1).violationsByYear).toEqual({ 0: 0, 5: 0 });
    expect(t(2).marginV).toBeGreaterThan(t(1).marginV);
    expectGolden(t(1).kwhYear0, 13.66, 2, 'tap 1 kWh');
    expectGolden(t(2).kwhYear0, 13.29, 2, 'tap 2 kWh');
  });

  it('year-5 minimum voltage: tap 1 217.29 V, tap 2 223.36 V', () => {
    expectGolden(t(1).minVByYear[5].value, 217.29, 2, 'tap 1');
    expectGolden(t(2).minVByYear[5].value, 223.36, 2, 'tap 2');
  });

  it('rejects taps 3 and 4 (they create violations: year 0 counts 15 and 174)', () => {
    expect(t(3).violationsByYear[0]).toBe(15);
    expect(t(4).violationsByYear[0]).toBe(174);
    expect(r.ranked.slice(2).map(x => x.tap).sort()).toEqual([3, 4]);
  });
});

describe('tap advisor behaviour', () => {
  it('judges only the chosen transformer\'s poles and leaves others alone', () => {
    const d = walkthroughIsland();
    d.transformers = [...d.transformers, { id: 'TX2', name: 'TX2', txRating: 160, tap: 2, hvActual: 11000, txXR: 3, txGroundOhms: 7.5 }];
    d.poles = [...d.poles, { id: 'Q1', feeder: 'G1', parent: 'TX2', spanM: 30, cond: '70ABC', grounded: false, groundOhms: 20 }];
    const r = tapAdvisor(d, 'TX2', { years: [0], hours: [12, 20] });
    r.byTap.forEach(t => {
      ['minV', 'maxV'].forEach(k => expect(t[k].pole).toBe('Q1'));
    });
  });

  it('reports progress over taps × years × hours', () => {
    const seen = [];
    tapAdvisor(walkthroughIsland(), 'TX', { years: [0], hours: [19, 20], onProgress: p => seen.push(p) });
    expect(seen.length).toBe(8);
    expect(seen[7]).toMatchObject({ done: 8, total: 8 });
  });

  it('rejects an unknown transformer', () => {
    expect(() => tapAdvisor(walkthroughIsland(), 'NOPE')).toThrow(/not in the design/);
  });
});
