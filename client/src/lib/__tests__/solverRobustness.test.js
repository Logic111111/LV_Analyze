import { describe, it, expect } from 'vitest';
import { runSnapshot, runDailyScan } from '../loadflow.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';
import { buildReportHtml } from '../report.js';

// P4.3 — convergence diagnostics, the α = 0.3 retry, voltage collapse.

describe('convergence diagnostics', () => {
  it('a clean solve reports its ΔV history, ending below the 1e-4 V tolerance', () => {
    const r = runSnapshot(walkthroughIsland(), { year: 0, hour: 20, solarMult: 0 });
    expect(r.status).toBe('converged');
    expect(r.convergence).toHaveLength(1);
    const c = r.convergence[0];
    expect(c).toMatchObject({ txId: 'TX', status: 'converged', retried: false });
    expect(c.deltaHistory).toHaveLength(r.iterUsed);
    expect(c.deltaHistory[c.deltaHistory.length - 1]).toBe(r.lastDelta);
    expect(r.lastDelta).toBeLessThan(1e-4);
    c.deltaHistory.slice(0, -1).forEach(d => expect(d).toBeGreaterThanOrEqual(1e-4));
  });

  it('every hour of a normal day converges first time', () => {
    runDailyScan(walkthroughIsland(), 0).forEach(r => {
      expect(r.status).toBe('converged');
      expect(r.convergence[0].retried).toBe(false);
    });
  });
});

// A design with no limits at all (as in the P1.3 fix-3 tests): only the solver can stop a search.
function limitlessIsland() {
  const d = walkthroughIsland();
  return {
    ...d, vdev: 1000,
    conductorLibrary: Object.fromEntries(Object.entries(d.conductorLibrary).map(([k, c]) => [k, { ...c, I: 1e9 }])),
    transformerLibrary: { ...d.transformerLibrary, 100: { ...d.transformerLibrary[100], kVA: 1e9 } }
  };
}

describe('retry with α = 0.3 from the best iterate', () => {
  it('rescues a sweep that used up MAX_ITER, and records both passes', () => {
    const r = runSnapshot(limitlessIsland(), { year: 0, hour: 12, extraPV: [{ pole: 'P3', phase: 'B', kva: 1000 }] });
    const c = r.convergence[0];
    expect(c.retried).toBe(true);
    expect(c.deltaHistory.length).toBeGreaterThan(150);
    expect(r.iterUsed).toBe(c.deltaHistory.length);
    expect(r.converged).toBe(true);
  });

  it('a sweep that still fails after the retry is "not-converged", with 2 × 150 iterations', () => {
    const r = runSnapshot(limitlessIsland(), { year: 0, hour: 12, extraPV: [{ pole: 'P3', phase: 'B', kva: 1500 }] });
    expect(r.status).toBe('not-converged');
    expect(r.iterUsed).toBe(300);
  });
});

describe('voltage collapse', () => {
  it('a load far beyond the network is reported as collapse, not as an ordinary non-convergence', () => {
    const d = walkthroughIsland();
    d.loads.push({ id: 'BIG', pole: 'P3', type: 'general', phase: 'A', kva: 400 });
    const r = runSnapshot(d, { year: 0, hour: 20, solarMult: 0 });
    expect(r.status).toBe('collapse');
    expect(r.convergence[0].status).toBe('collapse');
  });

  it('|V| below half of nominal counts as collapse even when the iteration settles', () => {
    const r = runSnapshot(limitlessIsland(), { year: 0, hour: 12, extraPV: [{ pole: 'P3', phase: 'B', kva: 1000 }] });
    expect(r.converged).toBe(true);
    expect(Math.min(...r.poleResults.flatMap(p => [p.volt.A, p.volt.B, p.volt.C]))).toBeLessThan(115);
    expect(r.status).toBe('collapse');
  });

  it('the report says "voltage collapse" in words', () => {
    const d = walkthroughIsland();
    d.loads.push({ id: 'BIG', pole: 'P3', type: 'general', phase: 'A', kva: 400 });
    const res = runSnapshot(d, { year: 0, hour: 20, solarMult: 0 });
    expect(buildReportHtml(d, res, null, null, null)).toContain('Voltage collapse');
  });
});
