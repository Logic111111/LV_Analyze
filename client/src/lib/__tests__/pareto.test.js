import { describe, it, expect } from 'vitest';
import { dominates, nonDominatedIndices, sortRows } from '../pareto.js';

// P4.5 — multi-criteria helpers.
describe('Pareto dominance', () => {
  const keys = ['v', 'kwh', 'capex'];
  it('needs no-worse everywhere and better somewhere; missing values are skipped', () => {
    expect(dominates({ v: 0, kwh: 10, capex: 5 }, { v: 0, kwh: 12, capex: 5 }, keys)).toBe(true);
    expect(dominates({ v: 0, kwh: 10, capex: 5 }, { v: 0, kwh: 10, capex: 5 }, keys)).toBe(false);
    expect(dominates({ v: 0, kwh: 9, capex: 6 }, { v: 0, kwh: 10, capex: 5 }, keys)).toBe(false);
    expect(dominates({ v: 0, kwh: 9, capex: null }, { v: 1, kwh: 10, capex: 5 }, keys)).toBe(true);
    expect(dominates({ v: null }, { v: null }, ['v'])).toBe(false);
  });
  it('finds the non-dominated set', () => {
    const rows = [{ v: 0, kwh: 14 }, { v: 0, kwh: 17 }, { v: 2, kwh: 10 }, { v: 3, kwh: 12 }];
    expect(nonDominatedIndices(rows, ['v', 'kwh'])).toEqual([0, 2]);
  });
});

describe('sortRows', () => {
  const rows = [{ id: 'a', values: { x: 2 } }, { id: 'b', values: { x: null } }, { id: 'c', values: { x: 1 } }, { id: 'd', values: { x: 2 } }];
  it('sorts stably, missing values last in both directions', () => {
    expect(sortRows(rows, 'x').map(r => r.id)).toEqual(['c', 'a', 'd', 'b']);
    expect(sortRows(rows, 'x', 'desc').map(r => r.id)).toEqual(['a', 'd', 'c', 'b']);
  });
});

describe('ladderMetrics carries the worst VUF (P4.5)', () => {
  it('is the largest snapshot worst VUF over every checked year and hour', async () => {
    const { ladderMetrics, runHours, DAILY_HOURS } = await import('../loadflow.js');
    const { walkthroughIsland } = await import('./fixtures/walkthroughIsland.js');
    const d = walkthroughIsland();
    const m = ladderMetrics(d, [0, 5], DAILY_HOURS);
    const expected = Math.max(...[0, 5].flatMap(year => runHours(d, DAILY_HOURS, { year, loadMult: 1, solarMult: 1 }).map(r => r.worstVuf.value)));
    expect(m.worstVufPct).toBe(expected);
    expect(m.worstVufPct).toBeGreaterThan(0);
  });
});
