import { describe, it, expect } from 'vitest';
import { withDefaults, balanceExactDP, balanceOptimise, proposePhaseBalance, applyPhaseBalance, evaluateDesign } from '../loadflow.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';
import { syntheticFeeder } from './fixtures/syntheticFeeder.js';
import { expectGolden } from './helpers.js';

// O2 goldens on the Walkthrough Island: exact DP balancing (O2.1) and balancing on the load-flow
// goal (O2.2), plus determinism and the legacy method's unchanged answer.
const fixture = () => withDefaults(walkthroughIsland());

describe('balanceExactDP (O2.1)', () => {
  it('golden: minimum nameplate spread for K = 0…9 is 22.5, 15, 7, 4, 1.5, 1.5, 0.5, 0.5, 0.5, 0.5 kVA', () => {
    const r = balanceExactDP(fixture(), 'TX', { maxMoves: 9 });
    expect(r.table.map(t => t.spread)).toEqual([22.5, 15, 7, 4, 1.5, 1.5, 0.5, 0.5, 0.5, 0.5]);
    expect(r.certificate).toBe('exact');
    expect(r.errorBound).toBe(0);
    expect(r.ms).toBeLessThan(200);
    // The global minimum (0.5 kVA) needs 6 moves; the legacy greedy gets 1.0 with 9.
    expect(r.table[9].moves).toBe(6);
    const legacy = proposePhaseBalance(fixture(), 'TX');
    expect(Math.max(...Object.values(legacy.after)) - Math.min(...Object.values(legacy.after))).toBe(1);
    // Each row's arrangement really has that spread and that many moves.
    r.table.forEach(t => {
      const tot = { A: 0, B: 0, C: 0 };
      r.items.forEach(it => { const c = t.changed.find(x => x.kind === it.kind && x.id === it.id); tot[c ? c.newPhase : it.phase] += it.kva; });
      expect(Math.max(tot.A, tot.B, tot.C) - Math.min(tot.A, tot.B, tot.C)).toBeCloseTo(t.spread, 9);
      expect(t.changed.length).toBeLessThanOrEqual(t.k);
    });
  });
  it('impedance-weighted: reports its rounding bound; the true spread is within it', () => {
    const r = balanceExactDP(fixture(), 'TX', { objective: 'impedanceWeighted' });
    expect(r.errorBound).toBeGreaterThan(0);
    r.table.forEach(t => expect(Math.abs(t.trueSpread - t.spread)).toBeLessThanOrEqual(r.errorBound + 1e-9));
  });
  it('coarsens the resolution instead of exceeding the state cap', () => {
    const r = balanceExactDP(withDefaults(syntheticFeeder()), 'TX', { maxMoves: 10, stateCap: 100000 });
    expect(r.resolution).toBeGreaterThan(0.5);
    expect(r.notes.join(' ')).toMatch(/retried at/);
  });
});

describe('balanceOptimise (O2.2)', () => {
  it('golden: exhaustive levels 1–3 (20/2/12.579, 174/33/11.749, 874/227/11.246)', () => {
    const r = balanceOptimise(fixture(), 'TX', { maxMoves: 3 });
    expect(r.certificate).toBe('exact');
    expect(r.table.slice(1).map(t => [t.distinct, t.feasible])).toEqual([[20, 2], [174, 33], [874, 227]]);
    expectGolden(r.table[1].bestWithin.lossKwh, 12.579, 3, '1 move');
    expectGolden(r.table[2].bestWithin.lossKwh, 11.749, 3, '2 moves');
    expectGolden(r.table[3].bestWithin.lossKwh, 11.246, 3, '3 moves');
    // 1 move: the P3 EV from A to B. 2: plus one P3 house A→B. 3: plus one P3 house A→C.
    const desc = (row) => row.bestWithin.changed.map(c => `${c.pole} ${c.label} ${c.from}→${c.to}`).sort();
    expect(desc(r.table[1])).toEqual(['P3 ev A→B']);
    expect(desc(r.table[2])).toEqual(['P3 ev A→B', 'P3 general A→B']);
    expect(desc(r.table[3])).toEqual(['P3 ev A→B', 'P3 general A→B', 'P3 general A→C']);
    // Recommended: the fewest moves with zero violations (1), and better loss with +1 / +2 moves.
    expect(r.recommended.moves).toBe(1);
    expect(r.alternatives.map(a => a.extraMoves)).toEqual([1, 2]);
    // Verified: the recommendation really has no violation in years 0 and 5.
    const d = fixture();
    const check = evaluateDesign(applyPhaseBalance(d, r.recommended.changed.map(c => ({ ...c, newPhase: c.to }))), { years: [0, 5] });
    expect(check.total).toBe(0);
    expect(check.converged).toBe(true);
    expect(r.ms).toBeLessThan(10000);
  });
  it('annealing alone (exact levels off) finds the 3-move optimum in at least 15 of 20 restarts', () => {
    const r = balanceOptimise(fixture(), 'TX', { maxMoves: 3, exact: false, restarts: 20, budget: 3000, seed: 1 });
    expect(r.certificate).toBe('heuristic');
    expectGolden(r.table[3].bestWithin.lossKwh, 11.246, 3, 'annealing, 3 moves');
    expect(r.restartsFoundBest.found).toBeGreaterThanOrEqual(15);
  });
  it('is deterministic: the same seed gives the same result', () => {
    const run = () => { const r = balanceOptimise(fixture(), 'TX', { maxMoves: 2, exact: false, restarts: 4, budget: 300, seed: 5 }); return JSON.stringify({ t: r.table, s: r.restartsFoundBest, p: r.pareto }); };
    expect(run()).toBe(run());
  });
});
