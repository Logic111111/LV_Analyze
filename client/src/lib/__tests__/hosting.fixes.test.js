import { describe, it, expect } from 'vitest';
import {
  runSnapshot, computeHostingCapacity, computeSystemHostingCapacity, computeBessHostingCapacity,
  computeSystemBessHostingCapacity, HOSTING_TEST_HOURS, rangeHours, bessMultiplierAt, searchMaxKva
} from '../loadflow.js';
import { balancedIsland } from './fixtures/referenceCases.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';

// P1.3 hosting-capacity bug fixes. Each describe block failed against the engine before its fix.

const bessHours = (d) => [...rangeHours(d.bessChargeStartHour, d.bessChargeEndHour), ...rangeHours(d.bessDischargeStartHour, d.bessDischargeEndHour)];
// The violations a BESS can actually cause at this hour (charging can't raise voltage, discharging
// can't lower it) — the same rule the BESS search applies.
const bessRelevant = (d, h, vs) => {
  const m = bessMultiplierAt(d, h);
  return m < 0 ? vs.filter(v => v.type !== 'overvoltage') : m > 0 ? vs.filter(v => v.type !== 'undervoltage') : vs;
};
function pvPasses(design, extraPV) {
  return HOSTING_TEST_HOURS.every(h => {
    const r = runSnapshot(design, { year: 0, hour: h, loadMult: 1, solarMult: 1, extraPV });
    return r.converged && r.violations.length === 0;
  });
}
function bessPasses(design, extraBess) {
  return bessHours(design).every(h => {
    const r = runSnapshot(design, { year: 0, hour: h, loadMult: 1, solarMult: 1, extraBess });
    return r.converged && bessRelevant(design, h, r.violations).length === 0;
  });
}

describe.each([
  ['balanced', balancedIsland],
  ['unbalanced', walkthroughIsland]
])('fix 1 (%s island): hosting never reports a size that was not tested (and passed)', (_name, build) => {
  const d = build();

  it('precondition: the island is clean at every PV test hour and every BESS-relevant test hour', () => {
    expect(pvPasses(d, [])).toBe(true);
    expect(bessPasses(d, [])).toBe(true);
  });

  it('every independent PV result passes a full load flow at exactly the reported kVA', () => {
    const failing = computeHostingCapacity(d).filter(r => !pvPasses(d, [{ pole: r.pole, phase: r.phase, kva: r.kva }]));
    expect(failing).toEqual([]);
  });

  it('the simultaneous PV allocation passes with every accepted addition in place at once', () => {
    const sys = computeSystemHostingCapacity(d);
    const all = sys.results.filter(r => r.achievableKva > 0).map(r => ({ pole: r.pole, phase: r.phase, kva: r.achievableKva }));
    expect(pvPasses(d, all)).toBe(true);
  });

  it('every independent BESS result and the simultaneous BESS allocation pass', () => {
    const failing = computeBessHostingCapacity(d).filter(r => !bessPasses(d, [{ pole: r.pole, phase: r.phase, kva: r.kva }]));
    expect(failing).toEqual([]);
    const sys = computeSystemBessHostingCapacity(d);
    expect(bessPasses(d, sys.results.filter(r => r.achievableKva > 0).map(r => ({ pole: r.pole, phase: r.phase, kva: r.achievableKva })))).toBe(true);
  });

  it('reports the cap itself when the cap passes (it is tested, not approached)', () => {
    const rows = computeHostingCapacity(d);
    expect(rows.find(r => r.pole === 'P1' && r.phase === 'A').kva).toBe(5);
    expect(pvPasses(d, [{ pole: 'P1', phase: 'A', kva: 5 }])).toBe(true);
  });

  it('reports the largest 0.05 kVA step that passes: one step more fails', () => {
    computeHostingCapacity(d).filter(r => r.kva < 5).forEach(r => {
      expect(pvPasses(d, [{ pole: r.pole, phase: r.phase, kva: r.kva + 0.05 }])).toBe(false);
    });
  });
});

describe('searchMaxKva (hand-checkable thresholds in place of load flows)', () => {
  const upTo = (limit) => (kva) => kva <= limit;

  it('floors to the 0.05 kVA grid instead of rounding up past the true limit', () => {
    // Limit 2.749: the old nearest-step rounding of a best near 2.74 would say 2.75 — which fails.
    expect(searchMaxKva(upTo(2.749), 5)).toBe(2.7);
  });

  it('reports a grid step just above the best bisection point when that step itself passes', () => {
    expect(searchMaxKva(upTo(2.751), 5)).toBe(2.75);
  });

  it('returns the cap when the cap passes (and only tests it once)', () => {
    let calls = 0;
    expect(searchMaxKva(kva => { calls++; return kva <= 100; }, 5)).toBe(5);
    expect(calls).toBe(1);
    expect(searchMaxKva(upTo(100), 3.33)).toBe(3.3);
  });

  it('returns 0 when nothing passes, or for a zero cap', () => {
    expect(searchMaxKva(() => false, 5)).toBe(0);
    expect(searchMaxKva(() => true, 0)).toBe(0);
  });

  it('never reports a size whose test failed', () => {
    for (let limit = 0.01; limit < 6; limit += 0.0137) {
      const r = searchMaxKva(upTo(limit), 5);
      expect(r <= limit + 1e-12).toBe(true);
      expect(Math.min(limit, 5) - r < 0.05 + 0.02).toBe(true); // within one step + the bisection resolution of the true limit (or the cap)
    }
  });
});
