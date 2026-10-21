import { describe, it, expect } from 'vitest';
import { withDefaults, proposePhaseBalance, applyPhaseBalance, bessLossOptimal, dailyEnergyLossKwh, runDailyScan, newOrWorsenedViolation, violationKey, bessRelevantViolations } from '../loadflow.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';
import { expectGolden } from './helpers.js';

// O4 — BESS sizing for minimum daily loss on the balanced fixture.
const balanced = () => { const d = withDefaults(walkthroughIsland()); return applyPhaseBalance(d, proposePhaseBalance(d, 'TX').changed); };

describe('bessLossOptimal (O4)', () => {
  it('never worse than no battery (13.29 kWh) nor the legacy allocation (25.47 kWh), and verified', () => {
    const d = balanced();
    const r = bessLossOptimal(d, { restarts: 4 });
    expectGolden(r.baselineLossKwh, 13.29, 2, 'no battery');
    expectGolden(r.legacy.lossKwh, 25.47, 2, 'legacy allocation (post-P1.3; the O-prompt quotes 25.46)');
    expect(r.lossKwh).toBeLessThanOrEqual(13.29);
    expect(r.lossKwh).toBeLessThanOrEqual(r.legacy.lossKwh);
    expect(r.certificate).toBe('heuristic');
    expect(r.restartsFoundBest.of).toBe(4);
    // Re-check from scratch: the reported loss and no new or worsened violation in any hour.
    const extraBess = r.allocation.map(a => ({ pole: a.pole, phase: a.phase, kva: a.kva }));
    expect(dailyEnergyLossKwh(d, extraBess).totalKwh).toBeCloseTo(r.lossKwh, 6);
    const base = runDailyScan(d, 0);
    runDailyScan(d, 0, { extraBess }).forEach((res, h) => {
      expect(res.converged).toBe(true);
      const b = new Map(bessRelevantViolations(d, h, base[h].violations).map(v => [violationKey(v), v]));
      expect(newOrWorsenedViolation(bessRelevantViolations(d, h, res.violations), b)).toBeNull();
    });
  });
  it('is deterministic for a seed', () => {
    const run = () => JSON.stringify(bessLossOptimal(balanced(), { restarts: 3, budget: 150, seed: 4 }).allocation);
    expect(run()).toBe(run());
  });
});
