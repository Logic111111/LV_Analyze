import { describe, it, expect } from 'vitest';
import {
  monteCarloStudy, adoptionSizesFromDesign, quantile, histogram, runMetrics, runHours, MC_CRITICAL_HOURS, DAILY_HOURS
} from '../loadflow.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';

// P4.4 — probabilistic (Monte Carlo) planning.

describe('helpers', () => {
  it('quantile interpolates linearly between order statistics', () => {
    const s = [1, 2, 3, 4, 5];
    expect(quantile(s, 0)).toBe(1);
    expect(quantile(s, 50)).toBe(3);
    expect(quantile(s, 90)).toBeCloseTo(4.6, 12);
    expect(quantile(s, 100)).toBe(5);
  });

  it('histogram counts every value once', () => {
    const h = histogram([0, 0.5, 1, 1, 2, 10], 5);
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(6);
    expect(h.edges).toHaveLength(6);
    expect(h.counts[4]).toBe(1); // the 10 sits in the last bin
    expect(histogram([3, 3, 3]).counts).toEqual([3]);
  });

  it('default sizes come from the design itself, never invented', () => {
    const d = walkthroughIsland();
    const s = adoptionSizesFromDesign(d);
    const evs = d.loads.filter(l => l.type === 'ev');
    expect(evs.every(l => Number(l.kva) === 7)).toBe(true); // the default design's EV and L18
    expect(s.ev).toEqual([{ kva: 7, weight: evs.length }]);
    const pvKvas = d.pv.map(p => Number(p.kva));
    expect(s.pv.reduce((n, o) => n + o.weight, 0)).toBe(pvKvas.filter(v => v > 0).length);
  });
});

describe('monteCarloStudy', () => {
  it('0 % adoption is deterministic and equals the base scan', () => {
    const d = walkthroughIsland();
    const r = monteCarloStudy(d, { evPct: 0, pvPct: 0, runs: 5, seed: 9, hours: DAILY_HOURS });
    const base = runMetrics(runHours(d, DAILY_HOURS, { year: 0, loadMult: 1, solarMult: 1 }));
    expect(r.base).toEqual(base);
    r.runs.forEach(m => {
      const { evAt, pvAt, ...metrics } = m;
      expect(evAt).toEqual([]); expect(pvAt).toEqual([]);
      expect(metrics).toEqual(base);
    });
    expect(r.probabilityAnyViolation).toBe(base.anyViolation ? 1 : 0);
    expect(r.distributions.minV.quantiles.P5).toBe(base.minV);
    expect(r.distributions.minV.quantiles.P95).toBe(base.minV);
  });

  it('the same seed gives identical results; another seed differs', () => {
    const opts = { evPct: 40, pvPct: 30, evSizes: [{ kva: 3.7, weight: 2 }, { kva: 7.4, weight: 1 }], pvSizes: [{ kva: 3, weight: 1 }, { kva: 5, weight: 1 }], runs: 40, seed: 123 };
    const a = monteCarloStudy(walkthroughIsland(), opts);
    expect(monteCarloStudy(walkthroughIsland(), opts)).toEqual(a);
    expect(monteCarloStudy(walkthroughIsland(), { ...opts, seed: 124 }).runs.map(m => m.evAt)).not.toEqual(a.runs.map(m => m.evAt));
  });

  it('places exactly round(% × customers) units, each at a distinct customer, on that customer\'s phase', () => {
    const d = walkthroughIsland();
    const customers = d.loads.filter(l => l.type === 'general');
    const r = monteCarloStudy(d, { evPct: 50, pvPct: 25, evSizes: [{ kva: 7, weight: 1 }], pvSizes: [{ kva: 4, weight: 1 }], runs: 20, seed: 5 });
    expect(r.customers).toBe(customers.length);
    expect(r.evPerRun).toBe(Math.round(0.5 * customers.length));
    expect(r.pvPerRun).toBe(Math.round(0.25 * customers.length));
    const slots = new Set(customers.map(c => `${c.pole} ${c.phase}`));
    r.runs.forEach(m => {
      expect(m.evAt).toHaveLength(r.evPerRun);
      m.evAt.forEach(s => { expect(s.endsWith(' 7')).toBe(true); expect(slots.has(s.slice(0, -2))).toBe(true); });
    });
  });

  it('heavy EV adoption at the evening peak raises the violation probability and lowers voltages', () => {
    const d = walkthroughIsland();
    const none = monteCarloStudy(d, { runs: 3, hours: [20] });
    const many = monteCarloStudy(d, { evPct: 80, evSizes: [{ kva: 7, weight: 1 }], runs: 30, seed: 2, hours: [20] });
    expect(many.probabilityAnyViolation).toBeGreaterThanOrEqual(none.probabilityAnyViolation);
    expect(many.distributions.minV.quantiles.P50).toBeLessThan(none.base.minV);
    expect(many.nodeProbability.map(n => n.pole)).toEqual(d.poles.map(p => p.id));
    many.nodeProbability.forEach(n => ['A', 'B', 'C'].forEach(ph => { expect(n[ph]).toBeGreaterThanOrEqual(0); expect(n[ph]).toBeLessThanOrEqual(1); }));
  });

  it('refuses adoption without size data ("data missing"), and defaults to the critical hours', () => {
    const d = walkthroughIsland();
    d.pv = [];
    expect(() => monteCarloStudy(d, { pvPct: 10, runs: 1 })).toThrow(/PV system sizes are missing/);
    expect(() => monteCarloStudy(d, { evPct: 10, evSizes: [], runs: 1 })).toThrow(/EV charger sizes are missing/);
    expect(monteCarloStudy(d, { runs: 1 }).inputs.hours).toEqual([...MC_CRITICAL_HOURS]);
  });

  it('switches EVs or solar on for the study when the design has them off, and says so', () => {
    const d = { ...walkthroughIsland(), includeEV: false };
    const r = monteCarloStudy(d, { evPct: 20, runs: 2 });
    expect(r.forcedOn).toEqual({ ev: true, solar: false });
  });
});

describe('worker task', () => {
  it('monteCarlo equals a direct call and clones cleanly', async () => {
    const { ENGINE_TASKS } = await import('../engineTasks.js');
    const args = { year: 1, evPct: 30, pvPct: 0, evSizes: [{ kva: 7, weight: 1 }], runs: 6, seed: 4, hours: [20] };
    const viaTask = ENGINE_TASKS.monteCarlo({ design: walkthroughIsland(), ...args }, {});
    expect(viaTask).toEqual(monteCarloStudy(walkthroughIsland(), args));
    expect(structuredClone(viaTask)).toEqual(viaTask);
  });
});
