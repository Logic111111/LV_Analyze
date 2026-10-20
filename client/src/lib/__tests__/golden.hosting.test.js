import { describe, it, expect } from 'vitest';
import {
  computeHostingCapacity, computeSystemHostingCapacity, computeBessHostingCapacity, computeSystemBessHostingCapacity
} from '../loadflow.js';
import { balancedIsland } from './fixtures/referenceCases.js';
import { expectGolden } from './helpers.js';

// Phase 0 golden table — PV and BESS hosting capacity on the balanced Walkthrough Island.
// Order is asserted as well as values: it is the ranking / build-priority the user sees.
//
// DELIBERATE GOLDEN CHANGES — P1.3 fix 1 (see PROGRESS.md, "Golden-value notes"): the old search
// rounded its best tested size to the NEAREST 0.05 kVA, so it could report the step above the
// largest size it had actually tested, and in this fixture several of those reported sizes fail a
// full load flow (e.g. 4.70 kVA at P2B causes a violation). The search now reports only sizes that
// have passed. Values marked "was" below changed for that reason and no other.

const sum = (rows, key) => rows.reduce((s, r) => s + r[key], 0);

describe('golden: computeHostingCapacity(balanced)', () => {
  const r = computeHostingCapacity(balancedIsland());

  it('seven locations at the 5 kVA cap, P2B 4.65, P3B 2.70, total 42.35', () => {
    expect(r.map(x => x.pole + x.phase)).toEqual(['P1A', 'P1B', 'P1C', 'P2A', 'P2C', 'P3A', 'P3C', 'P2B', 'P3B']);
    const expected = [5, 5, 5, 5, 5, 5, 5, 4.65 /* was 4.70 */, 2.70];
    r.forEach((x, i) => expectGolden(x.kva, expected[i], 2, x.pole + x.phase));
    expectGolden(sum(r, 'kva'), 42.35 /* was 42.40 */, 2, 'total');
  });
});

describe('golden: computeSystemHostingCapacity(balanced)', () => {
  const r = computeSystemHostingCapacity(balancedIsland());

  it('total 111.65 kVA with the queue order and independent/achievable split', () => {
    // was: total 111.75; P1C 40.05/40.05, P2C 22.25/5.10, P2A 21.50/9.10, P3C 13.85/1.00,
    // P3A 13.30/0.30, P1B 9.35/9.35, P2B 4.70/4.70 (queue order unchanged)
    const expected = [
      ['P1C', 40.00, 40.00], ['P1A', 39.45, 39.45], ['P2C', 22.20, 5.10], ['P2A', 21.50, 9.05],
      ['P3C', 13.80, 1.05], ['P3A', 13.25, 0.35], ['P1B', 9.30, 9.30], ['P2B', 4.65, 4.65], ['P3B', 2.70, 2.70]
    ];
    expect(r.results.map(x => x.pole + x.phase)).toEqual(expected.map(e => e[0]));
    r.results.forEach((x, i) => {
      expectGolden(x.independentKva, expected[i][1], 2, `${expected[i][0]} independent`);
      expectGolden(x.achievableKva, expected[i][2], 2, `${expected[i][0]} achievable`);
    });
    expectGolden(r.totalKva, 111.65 /* was 111.75 */, 2, 'total');
  });
});

describe('golden: computeBessHostingCapacity(balanced)', () => {
  it('total 45.00 kVA', () => {
    expectGolden(sum(computeBessHostingCapacity(balancedIsland()), 'kva'), 45.00, 2, 'total');
  });
});

describe('golden: computeSystemBessHostingCapacity(balanced)', () => {
  const r = computeSystemBessHostingCapacity(balancedIsland());

  it('total 69.95 kVA, first in queue P3B with loss score 17.05 W', () => {
    expectGolden(r.totalKva, 69.95 /* was 69.80 */, 2, 'total');
    expect(r.results[0].pole + r.results[0].phase).toBe('P3B');
    expectGolden(r.results[0].lossScore, 17.05, 2, 'P3B loss score W');
  });

  it('daily loss 13.29 → 25.47 kWh', () => {
    expectGolden(r.baselineLossKwh.totalKwh, 13.29, 2, 'baseline kWh');
    expectGolden(r.withBessLossKwh.totalKwh, 25.47 /* was 25.46 */, 2, 'with BESS kWh');
  });
});
