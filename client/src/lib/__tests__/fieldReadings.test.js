import { describe, it, expect } from 'vitest';
import { parseFieldCsv, compareMeasured, runSnapshot, FLAG_V } from '../loadflow.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';

// P6.4 — measured vs simulated. "Measured" values are synthetic: simulated values plus known offsets.

describe('measured vs simulated', () => {
  const d = walkthroughIsland();
  const s20 = runSnapshot(d, { year: 0, hour: 20, solarMult: 1 });
  const v = (pole, ph) => s20.poleResults.find(p => p.id === pole).volt[ph];

  it('parses readings with an optional current, and rejects bad lines', () => {
    const { readings, errors } = parseFieldCsv('pole,phase,hour,V,A\nP3,a,20,213.1,40\nP2,B,20,236\nP9,D,20,230\n');
    expect(readings).toEqual([{ pole: 'P3', phase: 'A', hour: 20, v: 213.1, amps: 40 }, { pole: 'P2', phase: 'B', hour: 20, v: 236, amps: null }]);
    expect(errors).toHaveLength(1);
  });

  it('error, bias, MAE and RMSE; flags |error| > 3 V', () => {
    const readings = [
      { pole: 'P1', phase: 'A', hour: 20, v: v('P1', 'A') + 1 },
      { pole: 'P2', phase: 'B', hour: 20, v: v('P2', 'B') - 1 },
      { pole: 'P3', phase: 'C', hour: 20, v: v('P3', 'C') + 4 }
    ];
    const r = compareMeasured(d, readings);
    expect(r.rows.map(x => Math.round(x.error * 1e9) / 1e9)).toEqual([1, -1, 4]);
    expect(r.stats.biasV).toBeCloseTo(4 / 3, 9);
    expect(r.stats.maeV).toBeCloseTo(2, 9);
    expect(r.stats.rmseV).toBeCloseTo(Math.sqrt(18 / 3), 9);
    expect(r.rows.map(x => x.flagged)).toEqual([false, false, true]);
    expect(FLAG_V).toBe(3);
  });

  it('phase-label check: a reading that matches another phase much better is marked', () => {
    // P3 at 20:00: A is far below B (212.9 vs ~239). A reading labelled A but showing B's voltage.
    const r = compareMeasured(d, [{ pole: 'P3', phase: 'A', hour: 20, v: v('P3', 'B') + 0.2 }]);
    expect(r.rows[0].flagged).toBe(true);
    expect(r.rows[0].likelyPhase).toBe('B');
    expect(r.stats.likelyPhaseErrors).toBe(1);
    // A small error on the right phase is not questioned.
    expect(compareMeasured(d, [{ pole: 'P3', phase: 'A', hour: 20, v: v('P3', 'A') + 0.5 }]).rows[0].likelyPhase).toBeNull();
  });

  it('compares a measured current with the span current, and lists unknown poles', () => {
    const pr = s20.poleResults.find(p => p.id === 'P2');
    const r = compareMeasured(d, [{ pole: 'P2', phase: 'A', hour: 20, v: v('P2', 'A'), amps: pr.cur.A + 2 }, { pole: 'Q7', phase: 'A', hour: 20, v: 230 }]);
    expect(r.rows[0].currentError).toBeCloseTo(2, 9);
    expect(r.unknown).toHaveLength(1);
  });
});
