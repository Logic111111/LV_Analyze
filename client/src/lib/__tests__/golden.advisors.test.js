import { describe, it, expect } from 'vitest';
import { computeFeederSplitCandidates, proposePhaseBalance, runSnapshot, systemLossW } from '../loadflow.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';
import { balancedIsland } from './fixtures/referenceCases.js';
import { expectGolden, poleResult } from './helpers.js';

// Phase 0 golden table — feeder split and load-balance advisors, and the balanced island's
// night-peak snapshot.

describe('golden: feeder split at P1 (100 kVA, tap 2, at the split point, 70ABC)', () => {
  const r = computeFeederSplitCandidates(
    walkthroughIsland(), 'P1',
    { txRating: 100, tap: 2, hvActual: 10800, txXR: 3, txGroundOhms: 7.5 },
    { mode: 'atSplit', cond: '70ABC' }
  );

  it('ranks P3, P2, P1 — all with 0 voltage violations — by daily kWh', () => {
    expect(r.candidates.map(c => [c.poleId, c.voltageViolationCount])).toEqual([['P3', 0], ['P2', 0], ['P1', 0]]);
    expectGolden(r.candidates[0].lossKwh, 14.56, 2, 'P3 kWh');
    expectGolden(r.candidates[1].lossKwh, 17.14, 2, 'P2 kWh');
    expectGolden(r.candidates[2].lossKwh, 21.88, 2, 'P1 kWh');
  });
});

describe('golden: proposePhaseBalance(d, "TX")', () => {
  const p = proposePhaseBalance(walkthroughIsland(), 'TX');

  it('proposes 9 moves in this exact order', () => {
    expect(p.changed.map(c => `${c.id} ${c.phase}→${c.newPhase}`)).toEqual([
      'S1 A→B', 'L2 B→C', 'L8 A→C', 'L9 A→B', 'L11 A→C', 'L12 A→B', 'L14 A→C', 'L15 A→B', 'L17 A→C'
    ]);
  });

  it('per-phase kVA before 30.5 / 8 / 8.5, after 16 / 15 / 16', () => {
    expectGolden(p.before.A, 30.5, 1, 'before A'); expectGolden(p.before.B, 8, 0, 'before B'); expectGolden(p.before.C, 8.5, 1, 'before C');
    expectGolden(p.after.A, 16, 0, 'after A'); expectGolden(p.after.B, 15, 0, 'after B'); expectGolden(p.after.C, 16, 0, 'after C');
  });
});

describe('golden: balanced island, year 0, 20:00, no solar', () => {
  const res = runSnapshot(balancedIsland(), { year: 0, hour: 20, solarMult: 0 });

  it('has no violations', () => {
    expect(res.violations).toHaveLength(0);
  });

  it('total loss 1158.5 W, line 677.6 W', () => {
    expectGolden(systemLossW(res).totalLossW, 1158.5, 1, 'total loss W');
    expectGolden(res.totalLossW, 677.6, 1, 'line loss W');
  });

  it('neutral current in span 1 is 42.12 A', () => {
    expectGolden(poleResult(res, 'P1').In, 42.12, 2, 'P1 I-N');
  });

  it('P3 voltages 225.39 / 235.89 / 226.74 V', () => {
    const p3 = poleResult(res, 'P3');
    expectGolden(p3.volt.A, 225.39, 2, 'P3 V-A');
    expectGolden(p3.volt.B, 235.89, 2, 'P3 V-B');
    expectGolden(p3.volt.C, 226.74, 2, 'P3 V-C');
  });
});
