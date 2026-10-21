import { describe, it, expect } from 'vitest';
import { searchMaxKva, searchWithLimit } from '../loadflow.js';

// O3.1 — the bisection safeguards: results on the 0.05 kVA grid never above a tested passing
// size, and the monotonicity probe that finds a feasible region above the first boundary. (The
// legacy hosting goldens, which are monotonic cases, are pinned unchanged in golden.hosting.test.js.)
describe('searchMaxKva safeguards', () => {
  it('monotonic: the largest passing grid step, no flag, the probes change nothing', () => {
    const tried = [];
    const info = {};
    const kva = searchMaxKva((s) => { tried.push(s); return s <= 7.33; }, 20, info);
    expect(kva).toBe(7.3);
    expect(info.nonMonotonic).toBeUndefined();
    expect(tried.filter(s => s > 7.33).every(s => s > 7.3)).toBe(true);
  });
  it('rounds down: never reports a size above every tested passing size', () => {
    for (const edge of [0.07, 1.049, 3.3333, 12.9999]) {
      const passed = [];
      const kva = searchMaxKva((s) => { const ok = s <= edge; if (ok) passed.push(s); return ok; }, 50);
      expect(kva).toBeLessThanOrEqual(edge);
      expect(passed.some(s => s >= kva - 1e-9)).toBe(true);
    }
  });
  it('non-monotonic: finds the upper feasible region [12, 14] above [0, 3] and flags it', () => {
    const feasible = (s) => s <= 3 || (s >= 12 && s <= 14);
    const info = {};
    const kva = searchMaxKva(feasible, 20, info);
    expect(kva).toBe(14);
    expect(info.nonMonotonic.firstBoundaryKva).toBe(3);
    expect(info.nonMonotonic.probePassKva).toBeGreaterThanOrEqual(12);
    expect(info.nonMonotonic.kva).toBe(14);
  });
  it('searchWithLimit reports the failure just above the answer, and the flag', () => {
    const r = searchWithLimit((s) => (s <= 3 || (s >= 12 && s <= 14) ? null : { reason: 'violation', detail: { hour: 12, size: s } }), 20);
    expect(r.kva).toBe(14);
    expect(r.nonMonotonic).toBeDefined();
    expect(r.limit).toBe('violation');
    expect(r.limitDetail.size).toBeGreaterThan(14);
    expect(r.limitDetail.size).toBeLessThan(14.1);
    const mono = searchWithLimit((s) => (s <= 5 ? null : { reason: 'violation', detail: { hour: 11, size: s } }), 20);
    expect(mono.nonMonotonic).toBeUndefined();
    expect(mono.limitDetail.size).toBeLessThan(5.1);
  });
  it('a size whose load flow fails to converge counts as infeasible (it can never pass)', () => {
    const r = searchWithLimit((s) => (s > 4 ? { reason: 'nonConvergence', detail: { hour: 13 } } : null), 10);
    expect(r.kva).toBe(4);
    expect(r.limit).toBe('nonConvergence');
  });
  it('the cap passing is reported exactly, with no probing', () => {
    let calls = 0;
    expect(searchMaxKva(() => { calls++; return true; }, 6.5)).toBe(6.5);
    expect(calls).toBe(1);
  });
});
