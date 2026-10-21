import { describe, it, expect } from 'vitest';
import { withDefaults, reconductorOptimise, reconductorAdvisor, compareLex } from '../loadflow.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';

// O6 — reconductoring as an optimisation. Two extra conductors are added to the fixture's library
// for the test only (made-up sizes, not library data), so each span has several options.
const TEST_LIB = { '95T': { name: '95 (test)', R: 0.32, Z: 0.33, X: 0.085, I: 245, neutralScale: 1.3 }, '150T': { name: '150 (test)', R: 0.206, Z: 0.22, X: 0.08, I: 320, neutralScale: 1.2 } };
const fixture = (costs) => {
  const w = walkthroughIsland();
  const lib = { ...w.conductorLibrary, ...TEST_LIB };
  return withDefaults({ ...w, conductorLibrary: costs ? Object.fromEntries(Object.entries(lib).map(([k, v]) => [k, { ...v, costPerM: costs[k] ?? null }])) : lib });
};
const COSTS = { '50ABC': 5, '70ABC': 6, '95T': 9, '150T': 14 };
const key = (r) => JSON.stringify(r.best.changes);

describe('reconductorOptimise (O6)', () => {
  it('enumeration and branch-and-bound agree, ranked by loss when no costs are entered', () => {
    const d = fixture();
    const en = reconductorOptimise(d, { years: [0, 5] });
    expect(en.method).toMatch(/Enumeration of all 36/);
    expect(en.certificate).toBe('exact');
    expect(en.useCapex).toBe(false);
    expect(en.notes.join(' ')).toMatch(/ranked by daily loss/);
    expect(en.best.totalViolations).toBe(0);
    const bb = reconductorOptimise(d, { years: [0, 5], exactCap: 1 });
    expect(bb.method).toMatch(/Branch-and-bound/);
    expect(bb.certificate).toBe('exact');
    expect(key(bb)).toBe(key(en));
  });
  it('with costs: the cheapest set that clears every violation; never worse than the legacy advisor', () => {
    const d = fixture(COSTS);
    const en = reconductorOptimise(d, { years: [0, 5] });
    const bb = reconductorOptimise(d, { years: [0, 5], exactCap: 1 });
    expect(en.useCapex).toBe(true);
    expect(key(bb)).toBe(key(en));
    expect(bb.evaluations).toBeLessThan(36); // the bound pruned something
    const legacy = reconductorAdvisor(d, { years: [0, 5] }).candidates[0];
    expect(compareLex([en.best.totalViolations, en.best.capex], [legacy.totalViolations, legacy.capex])).toBeLessThanOrEqual(0);
  });
  it('falls back to seeded annealing when the budget runs out', () => {
    const d = fixture(COSTS);
    const run = () => reconductorOptimise(d, { years: [0], exactCap: 1, budgetEvaluations: 3, saEvaluations: 15, seed: 2 });
    const a = run();
    expect(a.certificate).toBe('heuristic');
    expect(a.method).toMatch(/annealing/);
    expect(key(run())).toBe(key(a));
  });
});
