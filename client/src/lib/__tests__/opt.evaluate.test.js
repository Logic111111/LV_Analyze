import { describe, it, expect } from 'vitest';
import { withDefaults, evaluateDesign, createEvaluator, designSignature, compareLex, createParetoArchive, dominates, balanceableConnections, proposePhaseBalance, applyPhaseBalance } from '../loadflow.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';
import { expectGolden } from './helpers.js';

// O1.4 (evaluation, canonical signatures, LRU cache) and O1.5 (Pareto archive), including the
// O-prompt's legacy sanity goldens on the Walkthrough Island.
const fixture = () => withDefaults(walkthroughIsland());

describe('evaluateDesign', () => {
  it('legacy sanity goldens: unbalanced 3 violations / 19.156 kWh; balanced 0 / 13.288 kWh', () => {
    const d = fixture();
    const e = evaluateDesign(d, { years: [0, 5] });
    expect(e.byYear).toEqual({ 0: 3, 5: 6 });
    expect(e.violations.voltage).toBe(9);
    expectGolden(e.lossKwh, 19.156, 3, 'unbalanced daily loss');
    expect(e.converged).toBe(true);
    expect(e.marginV).toBeLessThan(0); // P3 A is outside the band at 20:00
    const q = proposePhaseBalance(d, 'TX');
    expect(q.changed).toHaveLength(9);
    expect(q.after).toEqual({ A: 16, B: 15, C: 16 });
    const b = evaluateDesign(applyPhaseBalance(d, q.changed), { years: [0, 5] });
    expect(b.total).toBe(0);
    expectGolden(b.lossKwh, 13.288, 3, 'balanced daily loss');
    expect(b.marginV).toBeGreaterThan(0);
  });
});

describe('designSignature', () => {
  it('ignores ids, order and labels; identical connections are interchangeable', () => {
    const d = fixture();
    const renamed = { ...d, name: 'Other', loads: d.loads.slice().reverse().map(l => ({ ...l, id: 'X' + l.id })) };
    expect(designSignature(renamed)).toBe(designSignature(d));
    // Two identical 1.5 kVA houses on P2 (L3 on C, L4 on A) swapping phases is the same design.
    const swapped = { ...d, loads: d.loads.map(l => (l.id === 'L3' ? { ...l, phase: 'A' } : l.id === 'L4' ? { ...l, phase: 'C' } : l)) };
    expect(designSignature(swapped)).toBe(designSignature(d));
    const moved = { ...d, loads: d.loads.map(l => (l.id === 'L18' ? { ...l, phase: 'B' } : l)) };
    expect(designSignature(moved)).not.toBe(designSignature(d));
  });
  it('the fixture has 40 single moves but only 20 distinct designs', () => {
    const d = fixture();
    const items = balanceableConnections(d, 'TX');
    const sigs = new Set();
    let raw = 0;
    items.forEach(it => ['A', 'B', 'C'].filter(ph => ph !== it.phase).forEach(ph => { raw++; sigs.add(designSignature(applyPhaseBalance(d, [{ ...it, newPhase: ph }]))); }));
    expect(raw).toBe(40);
    expect(sigs.size).toBe(20);
  });
});

describe('createEvaluator', () => {
  it('solves each distinct design once', () => {
    const ev = createEvaluator({ capacity: 10 });
    const d = fixture();
    const a = ev.evaluate(d, { hours: [20] });
    const b = ev.evaluate({ ...d, loads: d.loads.slice().reverse() }, { hours: [20] });
    expect(b).toBe(a);
    ev.evaluate(d, { hours: [12] });
    expect(ev.stats()).toEqual({ hits: 1, misses: 2, size: 2 });
  });
  it('evicts the least recently used', () => {
    const ev = createEvaluator({ capacity: 2 });
    const d = fixture();
    ev.evaluate(d, { hours: [1] }); ev.evaluate(d, { hours: [2] }); ev.evaluate(d, { hours: [1] }); ev.evaluate(d, { hours: [3] });
    expect(ev.has(d, { hours: [1] })).toBe(true);
    expect(ev.has(d, { hours: [2] })).toBe(false);
  });
});

describe('compareLex and the Pareto archive', () => {
  it('compares tuples lexicographically', () => {
    expect(compareLex([0, 12.5], [0, 13])).toBeLessThan(0);
    expect(compareLex([1, 0], [0, 99])).toBeGreaterThan(0);
    expect(compareLex([2, 3.0000000001], [2, 3])).toBe(0);
  });
  it('keeps only non-dominated points', () => {
    const a = createParetoArchive();
    expect(a.insert([1, 5], 'a')).toBe(true);
    expect(a.insert([2, 6], 'dominated')).toBe(false);
    expect(a.insert([1, 5], 'duplicate')).toBe(false);
    expect(a.insert([2, 3], 'b')).toBe(true);
    expect(a.insert([0, 9], 'c')).toBe(true);
    expect(a.insert([1, 2], 'd')).toBe(true); // dominates b ([2, 3]) and a ([1, 5])
    expect(a.points().map(p => p.payload)).toEqual(['c', 'd']);
    expect(a.fewestFeasible(p => p.criteria[1] <= 2).payload).toBe('d');
    expect(dominates([1, 1], [1, 1])).toBe(false);
  });
});
