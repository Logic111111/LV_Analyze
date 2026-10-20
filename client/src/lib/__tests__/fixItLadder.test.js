import { describe, it, expect } from 'vitest';
import { fixItLadder, LADDER_STEPS, scanAndSummarize, runDailyScan } from '../loadflow.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';
import { balancedIsland } from './fixtures/referenceCases.js';
import { expectGolden } from './helpers.js';

// P2.6 — fix-it ladder.

describe('golden: fix-it ladder on the Walkthrough Island', () => {
  const r = fixItLadder(walkthroughIsland());

  it('stops at step 1 (balance, 9 moves): 0 violations in years 0 and 5', () => {
    expect(r.solvedBy).toBe('balance');
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0]).toMatchObject({ step: 'balance', moves: 9, solves: true });
    expect(r.steps[0].metrics.violationsByYear).toEqual({ 0: 0, 5: 0 });
  });

  it('19.16 → 13.29 kWh/day', () => {
    expectGolden(r.baseline.kwhYear0, 19.16, 2, 'before');
    expectGolden(r.steps[0].metrics.kwhYear0, 13.29, 2, 'after');
  });

  it('the solved design is the balanced island', () => {
    expect(r.steps[0].design.loads).toEqual(balancedIsland().loads);
    expect(r.steps[0].design.pv).toEqual(balancedIsland().pv);
  });
});

describe('fix-it ladder behaviour', () => {
  it('follows a user-chosen order, reporting the steps that were not enough', () => {
    const r = fixItLadder(walkthroughIsland(), { order: ['reconductor', 'tap', 'balance'] });
    expect(r.steps.map(s => s.step)).toEqual(['reconductor', 'tap', 'balance']);
    expect(r.steps[0]).toMatchObject({ solves: false });
    expect(r.steps[0].metrics.violationsByYear[0]).toBe(2); // P3 → 70ABC golden
    expect(r.steps[1].design).toBeNull(); // tap 2 is already the best position
    expect(r.solvedBy).toBe('balance');
  });

  it('can run every step instead of stopping at the first success', () => {
    const r = fixItLadder(walkthroughIsland(), { stopAtFirst: false });
    expect(r.steps.map(s => s.step)).toEqual(LADDER_STEPS);
    expect(r.solvedBy).toBe('balance');
    const split = r.steps.find(s => s.step === 'split');
    expect(split.newTransformers).toBe(1);
    expect(split.design.transformers).toHaveLength(2);
  });

  it('each step\'s metrics match an independent scan of its design', () => {
    const r = fixItLadder(walkthroughIsland(), { stopAtFirst: false, years: [0] });
    r.steps.filter(s => s.design).forEach(s => {
      const scan = scanAndSummarize(s.design);
      expect(s.metrics.violationsByYear[0]).toBe(scan.voltageViolationCount);
      expect(s.metrics.kwhYear0).toBeCloseTo(scan.lossKwh, 9);
    });
  });

  it('a compliant design needs no steps', () => {
    const r = fixItLadder(balancedIsland());
    expect(r.alreadyCompliant).toBe(true);
    expect(r.steps).toEqual([]);
    expect(runDailyScan(balancedIsland(), 5).flatMap(x => x.violations)).toEqual([]);
  });

  it('ignores unknown step names in the order', () => {
    expect(fixItLadder(walkthroughIsland(), { order: ['nope', 'balance'] }).order).toEqual(['balance']);
  });
});
