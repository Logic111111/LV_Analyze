import { describe, it, expect } from 'vitest';
import { withDefaults, dualFeederOptimise, searchDualFeederSplit } from '../loadflow.js';
import { twoFeeders } from './fixtures/twoFeeders.js';

// O5 — the dual-feeder split: exhaustive within pairCap, and the heuristic (shortlist + local
// improvement + random sample) agrees with the exhaustive answer on two 12-pole feeders.
const txSpec = { name: 'TX2', txRating: 100, tap: 2, hvActual: 10800, txXR: 3, txGroundOhms: 7.5 };
const HOURS = [12, 19, 20];

describe('dualFeederOptimise (O5)', () => {
  it('two 12-pole feeders: the heuristic finds the exhaustive optimum', () => {
    const d = withDefaults(twoFeeders());
    const exact = dualFeederOptimise(d, 'OP1', txSpec, '70ABC', { hours: HOURS });
    expect(exact.totalPairs).toBe(144);
    expect(exact.certificate).toBe('exact');
    expect(exact.evaluations).toBe(144);
    expect(exact.baseline.voltageViolationCount).toBeGreaterThan(0);
    const heur = dualFeederOptimise(d, 'OP1', txSpec, '70ABC', { hours: HOURS, pairCap: 50, k: 3 });
    expect(heur.certificate).toBe('heuristic');
    expect(heur.coveragePct).toBeLessThan(100);
    const best = exact.candidates[0], got = heur.candidates[0];
    expect([got.voltageViolationCount, got.lossKwh.toFixed(9)]).toEqual([best.voltageViolationCount, best.lossKwh.toFixed(9)]);
    // Never worse than the legacy k×k shortlist with the same k.
    const legacy = searchDualFeederSplit(d, 'OP1', txSpec, '70ABC', HOURS, 1, { shortlistK: 3 });
    const l = legacy.candidates[0];
    expect(got.voltageViolationCount < l.voltageViolationCount || (got.voltageViolationCount === l.voltageViolationCount && got.lossKwh <= l.lossKwh + 1e-9)).toBe(true);
  });
  it('is deterministic for a seed', () => {
    const d = withDefaults(twoFeeders());
    const run = () => { const r = dualFeederOptimise(d, 'OP1', txSpec, '70ABC', { hours: [20], pairCap: 30, k: 2, seed: 9 }); return JSON.stringify(r.candidates.map(c => [c.poleA, c.poleB])); };
    expect(run()).toBe(run());
  });
});
