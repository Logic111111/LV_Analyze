import { describe, it, expect } from 'vitest';
import {
  runSnapshot, computeHostingCapacity, computeSystemHostingCapacity, computeBessHostingCapacity,
  computeSystemBessHostingCapacity, HOSTING_TEST_HOURS, rangeHours, bessMultiplierAt, searchMaxKva,
  pvHostingBaseline, bessHostingBaseline, newOrWorsenedViolation
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

// Walkthrough Island plus a 20 kVA single-phase shop on P3-A: P3-A sits below the statutory band
// at every PV and BESS test hour before anything is added.
function shopIsland() {
  const d = walkthroughIsland();
  d.loads.push({ id: 'SHOP', pole: 'P3', type: 'shop', phase: 'A', kva: 20 });
  return d;
}
const key = v => `${v.pole}|${v.phase}|${v.type}`;
// "Passes relative to the baseline": converged, and every violation already existed at that hour
// (same pole/phase/type) and is no more than 0.01 (V or %) worse.
function passesVsBaseline(design, hours, extra, kind, relevant = (h, vs) => vs) {
  return hours.every(h => {
    const base = new Map(relevant(h, runSnapshot(design, { year: 0, hour: h }).violations).map(v => [key(v), v]));
    const r = runSnapshot(design, { year: 0, hour: h, loadMult: 1, solarMult: 1, [kind]: extra });
    if (!r.converged) return false;
    return relevant(h, r.violations).every(v => {
      const b = base.get(key(v));
      if (!b) return false;
      return v.type === 'undervoltage' ? v.value >= b.value - 0.01 : v.value <= b.value + 0.01;
    });
  });
}

describe('fix 2: a pre-existing violation no longer zeroes every hosting result', () => {
  const d = shopIsland();

  it('precondition: P3-A is undervoltage at every PV test hour before anything is added', () => {
    HOSTING_TEST_HOURS.forEach(h => {
      expect(runSnapshot(d, { year: 0, hour: h }).violations.map(key)).toContain('P3|A|undervoltage');
    });
  });

  it('PV hosting finds capacity, and every reported size passes relative to the baseline', () => {
    const rows = computeHostingCapacity(d);
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach(r => expect(passesVsBaseline(d, HOSTING_TEST_HOURS, [{ pole: r.pole, phase: r.phase, kva: r.kva }], 'extraPV')).toBe(true));
  });

  it('PV on the undervoltage phase itself is accepted — it relieves the violation', () => {
    expect(computeHostingCapacity(d).find(r => r.pole === 'P3' && r.phase === 'A')?.kva).toBeGreaterThan(0);
  });

  it('a candidate that creates a NEW violation is still rejected', () => {
    // 5 kVA of PV on P3-B pushes P3-B over the upper limit at 12:00 (≈248 V) — not in the baseline.
    expect(passesVsBaseline(d, [12], [{ pole: 'P3', phase: 'B', kva: 5 }], 'extraPV')).toBe(false);
    expect(computeHostingCapacity(d).find(r => r.pole === 'P3' && r.phase === 'B')?.kva ?? 0).toBeLessThan(5);
  });

  it('newOrWorsenedViolation: new keys and >0.01 worsening fail; ≤0.01 and improvement pass', () => {
    const base = new Map([
      ['P3|A|undervoltage', { pole: 'P3', phase: 'A', type: 'undervoltage', value: 205 }],
      ['P2|B|overvoltage', { pole: 'P2', phase: 'B', type: 'overvoltage', value: 250 }],
      ['P1|A|thermal', { pole: 'P1', phase: 'A', type: 'thermal', value: 104 }]
    ]);
    const v = (pole, phase, type, value) => ({ pole, phase, type, value });
    expect(newOrWorsenedViolation([v('P3', 'A', 'undervoltage', 204.995)], base)).toBeNull();   // 0.005 V worse
    expect(newOrWorsenedViolation([v('P3', 'A', 'undervoltage', 206)], base)).toBeNull();       // better
    expect(newOrWorsenedViolation([v('P3', 'A', 'undervoltage', 204.98)], base)).not.toBeNull(); // 0.02 V worse
    expect(newOrWorsenedViolation([v('P2', 'B', 'overvoltage', 250.009)], base)).toBeNull();
    expect(newOrWorsenedViolation([v('P2', 'B', 'overvoltage', 250.02)], base)).not.toBeNull();
    expect(newOrWorsenedViolation([v('P1', 'A', 'thermal', 104.02)], base)).not.toBeNull();     // % points
    expect(newOrWorsenedViolation([v('P3', 'B', 'overvoltage', 244)], base)).not.toBeNull();    // new key
    expect(newOrWorsenedViolation([], base)).toBeNull();
  });

  it('BESS hosting finds capacity, judged against the same baseline', () => {
    const rows = computeBessHostingCapacity(d);
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach(r => expect(passesVsBaseline(d, bessHours(d), [{ pole: r.pole, phase: r.phase, kva: r.kva }], 'extraBess', (h, vs) => bessRelevant(d, h, vs))).toBe(true));
  });

  it('charging BESS on the undervoltage phase is rejected — it would make P3-A worse', () => {
    expect(computeBessHostingCapacity(d).find(r => r.pole === 'P3' && r.phase === 'A')).toBeUndefined();
  });

  it('the baseline is reported so the pages can list it', () => {
    const b = pvHostingBaseline(d);
    expect(b.violations.map(v => v.hour)).toEqual(HOSTING_TEST_HOURS);
    expect(b.violations.every(v => v.pole === 'P3' && v.phase === 'A' && v.type === 'undervoltage')).toBe(true);
    expect(b.nonConvergedHours).toEqual([]);
    expect(bessHostingBaseline(d).violations.length).toBeGreaterThan(0);
  });
});

// Walkthrough Island with statutory limits so wide (±1000 %), conductor ratings so high, and a
// transformer kVA base so large (for the loading % only — its impedance is unchanged) that no
// violation can ever be raised: the only thing that can stop a large PV/BESS addition is the load
// flow failing to converge (it does, somewhere between 400 and 1000 kVA of PV at P3-B, and below
// 500 kVA of BESS charging at P3-B).
function limitlessIsland() {
  const d = walkthroughIsland();
  return {
    ...d, vdev: 1000,
    conductorLibrary: Object.fromEntries(Object.entries(d.conductorLibrary).map(([k, c]) => [k, { ...c, I: 1e9 }])),
    transformerLibrary: { ...d.transformerLibrary, 100: { ...d.transformerLibrary[100], kVA: 1e9 } }
  };
}

describe('fix 3: a non-converged load flow is infeasible, not a pass', () => {
  const d = limitlessIsland();

  it('precondition: 1000 kVA at P3-B does not converge, yet raises no violation', () => {
    const r = runSnapshot(d, { year: 0, hour: 12, extraPV: [{ pole: 'P3', phase: 'B', kva: 1000 }] });
    expect(r.converged).toBe(false);
    expect(r.violations).toEqual([]);
  });

  it('PV hosting stops where the load flow stops converging, and says why', () => {
    // Before the fix this row came back at the 2000 kVA ceiling with no limit recorded. (The search
    // warm-starts each evaluation from the last converged one — P1.4 — so it gets a little further
    // into this pathological, limit-free region than a flat start would; with real statutory
    // limits a violation stops it long before, see the fix-1 tests, which re-check every reported
    // size with cold-start load flows.)
    const row = computeHostingCapacity(d, 2000).find(r => r.pole === 'P3' && r.phase === 'B');
    expect(row.kva).toBeLessThan(2000);
    expect(row.limit).toBe('nonConvergence');
    expect(HOSTING_TEST_HOURS).toContain(row.limitDetail.hour);
  });

  it('BESS hosting treats non-convergence the same way', () => {
    const row = computeBessHostingCapacity(d, 2000).find(r => r.pole === 'P3' && r.phase === 'B');
    expect(row.kva).toBeLessThan(2000);
    expect(row.limit).toBe('nonConvergence');
  });

  it('rows say what limited them: the cap, or the violation that stopped them', () => {
    const rows = computeHostingCapacity(balancedIsland());
    const p1a = rows.find(r => r.pole === 'P1' && r.phase === 'A');
    expect(p1a.limit).toBe('cap');
    const p3b = rows.find(r => r.pole === 'P3' && r.phase === 'B');
    expect(p3b.limit).toBe('violation');
    expect(p3b.limitDetail).toMatchObject({ pole: expect.any(String), type: expect.stringMatching(/overvoltage|thermal/) });
    expect(HOSTING_TEST_HOURS).toContain(p3b.limitDetail.hour);
  });
});
