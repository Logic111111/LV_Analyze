import { describe, it, expect } from 'vitest';
import { runSnapshot, runDailyScan, scanAndSummarize, computeFeederSplitCandidates } from '../loadflow.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';
import { expectGolden } from './helpers.js';

// P1.3 fix 4 — the scan summary's "transformer current" was a balanced-equivalent estimate from
// peak kVA (kVA·1000 / (√3·415)), which badly understates the worst phase on an unbalanced
// transformer. The solver's true per-phase transformer current is now tracked as well.

describe('fix 4: true maximum phase current at the transformer', () => {
  it('each snapshot reports |I| per phase at the transformer; with one feeder it equals the first span', () => {
    const r = runSnapshot(walkthroughIsland(), { year: 0, hour: 20, solarMult: 0 });
    const t = r.transformers[0];
    const p1 = r.poleResults.find(p => p.id === 'P1');
    expect(t.phaseCurrentA.A).toBeCloseTo(p1.cur.A, 9);
    expect(t.phaseCurrentA.B).toBeCloseTo(p1.cur.B, 9);
    expect(t.phaseCurrentA.C).toBeCloseTo(p1.cur.C, 9);
    expectGolden(t.phaseCurrentA.A, 121.297, 3, 'TX phase A at 20:00 (= P1 span golden)');
  });

  it('the scan summary carries the true max phase current over the scanned hours', () => {
    const d = walkthroughIsland();
    const s = scanAndSummarize(d);
    let trueMax = 0;
    runDailyScan(d, 0).forEach(r => {
      const p1 = r.poleResults.find(p => p.id === 'P1');
      trueMax = Math.max(trueMax, p1.cur.A, p1.cur.B, p1.cur.C);
    });
    expect(s.transformers[0].txMaxPhaseCurrentA).toBeCloseTo(trueMax, 9);
  });

  it('on the unbalanced island the true value is over twice the balanced-equivalent estimate', () => {
    const t = scanAndSummarize(walkthroughIsland()).transformers[0];
    expect(t.peakCurrentA).toBeCloseTo(t.peakKva * 1000 / (Math.sqrt(3) * 415), 9); // unchanged
    expect(t.txMaxPhaseCurrentA).toBeGreaterThan(2 * t.peakCurrentA);
  });

  it('feeder split candidates carry it for every transformer in the resulting design', () => {
    const r = computeFeederSplitCandidates(walkthroughIsland(), 'P1',
      { txRating: 100, tap: 2, hvActual: 10800, txXR: 3, txGroundOhms: 7.5 }, { mode: 'atSplit', cond: '70ABC' });
    r.candidates.forEach(c => {
      expect(c.transformers).toHaveLength(2);
      c.transformers.forEach(t => expect(Number.isFinite(t.txMaxPhaseCurrentA)).toBe(true));
      // The new transformer always carries load; the original carries none when the cut is at P1
      // (everything moved), so only a positive total is guaranteed.
      expect(c.transformers[1].txMaxPhaseCurrentA).toBeGreaterThan(0);
    });
  });
});
