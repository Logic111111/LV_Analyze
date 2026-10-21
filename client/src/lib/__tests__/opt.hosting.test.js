import { describe, it, expect } from 'vitest';
import {
  withDefaults, proposePhaseBalance, applyPhaseBalance, hostingMaxTotalSLP, hostingFairShare, computeSystemHostingCapacity,
  computeSystemBessHostingCapacity, evaluateDesign, HOSTING_TEST_HOURS, runSnapshot, newOrWorsenedViolation, pvHostingBaseline
} from '../loadflow.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';
import { expectGolden } from './helpers.js';

// O3.2 (maximum simultaneous hosting by SLP) and O3.3 (fair share) on the balanced fixture,
// test hours 09–15, year 0. Every allocation is re-verified here with independent full load flows.
const balanced = () => { const d = withDefaults(walkthroughIsland()); return applyPhaseBalance(d, proposePhaseBalance(d, 'TX').changed); };

/** No new or worsened violation and converged at every test hour — checked from scratch. */
function verifiedPv(design, allocation, txBoth = false) {
  const d = txBoth ? { ...design, standards: { ...design.standards, txLimitBothDirections: true } } : design;
  const base = pvHostingBaseline(d);
  const extraPV = allocation.map(a => ({ pole: a.pole, phase: a.phase, kva: a.kva }));
  return HOSTING_TEST_HOURS.every(h => {
    const r = runSnapshot(d, { year: 0, hour: h, loadMult: 1, solarMult: 1, extraPV });
    return r.converged && !newOrWorsenedViolation(r.violations, base.byHour.get(h));
  });
}

describe('hostingMaxTotalSLP (O3.2)', () => {
  it('import-only rule: verified total ≥ 149.0 kVA (and above the legacy queue)', () => {
    const d = balanced();
    const r = hostingMaxTotalSLP(d);
    expect(r.totalKva).toBeGreaterThanOrEqual(149.0);
    expect(r.totalKva).toBeGreaterThan(computeSystemHostingCapacity(d).totalKva);
    expect(r.certificate).toBe('lp-bound');
    expect(r.bound).toBeGreaterThanOrEqual(r.totalKva);
    expect(r.gapPct).toBeLessThan(5);
    expect(verifiedPv(d, r.allocation)).toBe(true);
    // The three phases of P1 together host far more than one phase alone.
    const p1 = r.allocation.filter(a => a.pole === 'P1');
    expect(p1).toHaveLength(3);
    expect(p1.reduce((s, a) => s + a.kva, 0)).toBeGreaterThan(110);
    expect(r.allocation.every(a => Math.abs(a.kva * 20 - Math.round(a.kva * 20)) < 1e-9)).toBe(true); // 0.05 kVA grid
  });
  it('limit in both directions: verified total ≥ 103.80 kVA, no transformer overload either way', () => {
    const d = balanced();
    const r = hostingMaxTotalSLP(d, { txLimitBothDirections: true });
    expect(r.totalKva).toBeGreaterThanOrEqual(103.8);
    expect(verifiedPv(d, r.allocation, true)).toBe(true);
    const e = evaluateDesign(d, { hours: HOSTING_TEST_HOURS, extraPV: r.allocation, txLimitBothDirections: true });
    expect(e.violations.transformer).toBe(0);
  });
  it('BESS: verified total ≥ the legacy queue', () => {
    const d = balanced();
    const legacy = computeSystemBessHostingCapacity(d);
    expectGolden(legacy.totalKva, 69.95, 2, 'legacy BESS queue (post-P1.3; the O-prompt quotes 69.80)');
    const r = hostingMaxTotalSLP(d, { kind: 'bess' });
    expect(r.totalKva).toBeGreaterThanOrEqual(legacy.totalKva);
  });
  it('respects per-location caps and is deterministic', () => {
    const d = balanced();
    const a = hostingMaxTotalSLP(d, { caps: 5 });
    expect(a.allocation.every(x => x.kva <= 5 + 1e-9)).toBe(true);
    expect(JSON.stringify(hostingMaxTotalSLP(d, { caps: 5 }).allocation)).toBe(JSON.stringify(a.allocation));
  });
});

describe('hostingFairShare (O3.3)', () => {
  it('golden: about 2.94 kVA at each of the 9 locations, about 26.43 kVA in total', () => {
    const r = hostingFairShare(balanced());
    expect(r.locations).toHaveLength(9);
    expectGolden(r.sizeKva, 2.94, 2, 'uniform size', 0.02);
    // The O-prompt quotes 26.43 kVA; this code's boundary (after the P1.3 hosting fixes) is 2.938 → 26.44.
    expectGolden(r.totalKva, 26.43, 2, 'fair-share total', 0.02);
    expect(r.nonMonotonic).toBeUndefined();
    expect(verifiedPv(balanced(), r.locations.map(l => ({ ...l, kva: r.sizeKva })))).toBe(true);
  });
});
