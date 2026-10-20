import { describe, it, expect } from 'vitest';
import { C, sequenceComponents, vufPct, runSnapshot, scanAndSummarize, withDefaults, defaultDesign } from '../loadflow.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';
import { balancedIsland } from './fixtures/referenceCases.js';
import { poleResult } from './helpers.js';

// P2.1 — symmetrical components and voltage unbalance factor.

const a = C.fromPolar(1, 120), a2 = C.fromPolar(1, 240);
const pol = (m, d) => C.fromPolar(m, d);
// Builds Va, Vb, Vc from chosen sequence components: Va = V0+V1+V2, Vb = V0+a²V1+aV2, Vc = V0+aV1+a²V2.
function fromSequence(V0, V1, V2) {
  return {
    A: C.add(C.add(V0, V1), V2),
    B: C.add(C.add(V0, C.mul(a2, V1)), C.mul(a, V2)),
    C: C.add(C.add(V0, C.mul(a, V1)), C.mul(a2, V2))
  };
}

describe('sequence components', () => {
  it('a perfectly balanced A→B→C set is pure positive sequence: VUF = 0', () => {
    const v = { A: pol(230, 0), B: pol(230, -120), C: pol(230, 120) };
    const { V0, V1, V2 } = sequenceComponents(v);
    expect(C.abs(V1)).toBeCloseTo(230, 10);
    expect(C.abs(V2)).toBeLessThan(1e-12);
    expect(C.abs(V0)).toBeLessThan(1e-12);
    expect(vufPct(v)).toBeLessThan(1e-12);
  });

  it('recovers chosen components exactly, so VUF is |V2|/|V1| (hand case: 230 V and 4.6 V → 2 %)', () => {
    const V0 = pol(3, 40), V1 = pol(230, 5), V2 = pol(4.6, -70);
    const v = fromSequence(V0, V1, V2);
    const s = sequenceComponents(v);
    [[s.V0, V0], [s.V1, V1], [s.V2, V2]].forEach(([got, want]) => {
      expect(got.re).toBeCloseTo(want.re, 10);
      expect(got.im).toBeCloseTo(want.im, 10);
    });
    expect(vufPct(v)).toBeCloseTo(2, 10);
  });

  it('a common neutral shift only changes V0 (VUF unchanged)', () => {
    const v = fromSequence(pol(0, 0), pol(231, 0), pol(5, 33));
    const shift = pol(12, -50);
    const shifted = { A: C.sub(v.A, shift), B: C.sub(v.B, shift), C: C.sub(v.C, shift) };
    expect(vufPct(shifted)).toBeCloseTo(vufPct(v), 10);
  });

  it('line-to-line voltages give the same VUF as phase-to-neutral ones', () => {
    const v = fromSequence(pol(7, 10), pol(229, 2), pol(6.2, 140));
    const ll = { A: C.sub(v.A, v.B), B: C.sub(v.B, v.C), C: C.sub(v.C, v.A) };
    expect(vufPct(ll)).toBeCloseTo(vufPct(v), 10);
  });
});

describe('VUF in load-flow results', () => {
  it('every pole result and transformer bus carries vufPct, matching its phasors', () => {
    const r = runSnapshot(walkthroughIsland(), { year: 0, hour: 20, solarMult: 0 });
    r.poleResults.forEach(p => expect(p.vufPct).toBeCloseTo(vufPct(p.vph), 12));
    expect(r.transformers[0].busVufPct).toBeCloseTo(vufPct(r.transformers[0].busVph), 12);
    expect(r.worstVuf.pole).toBe('P3');
    expect(r.worstVuf.value).toBe(Math.max(...r.poleResults.map(p => p.vufPct)));
  });

  it('on the fixture at P3, 20:00, the unbalanced island has a higher VUF than the balanced one', () => {
    const opts = { year: 0, hour: 20, solarMult: 0 };
    const unbal = poleResult(runSnapshot(walkthroughIsland(), opts), 'P3').vufPct;
    const bal = poleResult(runSnapshot(balancedIsland(), opts), 'P3').vufPct;
    expect(unbal).toBeGreaterThan(bal);
    // 1.70 % vs 0.74 %. Note how far below the phase-to-neutral spread this is (212.9 V vs 239.2 V
    // at P3): most of that spread is neutral shift — zero sequence — which VUF rightly ignores.
    expect(unbal).toBeCloseTo(1.70, 2);
    expect(bal).toBeCloseTo(0.74, 2);
  });

  it('is not a violation by default (goldens unchanged)…', () => {
    const r = runSnapshot(walkthroughIsland(), { year: 0, hour: 20, solarMult: 0 });
    expect(r.violations.map(v => v.type)).toEqual(['undervoltage']);
    expect(r.vufLimitPct).toBe(2);
  });

  it('…but raises an "unbalance" violation above the limit when the standards ask for it', () => {
    const d = { ...walkthroughIsland(), standards: { vufLimitPct: 1.5, vufAsViolation: true } };
    const r = runSnapshot(d, { year: 0, hour: 20, solarMult: 0 });
    const u = r.violations.filter(v => v.type === 'unbalance');
    expect(u.map(v => v.pole)).toEqual(['P3']); // 1.70 % > 1.5 %; P1 1.16 %, P2 1.44 % pass
    u.forEach(v => { expect(v.phase).toBe('-'); expect(v.value).toBeGreaterThan(1.5); });
    expect(runSnapshot({ ...d, standards: { vufLimitPct: 2, vufAsViolation: true } }, { year: 0, hour: 20, solarMult: 0 }).violations.filter(v => v.type === 'unbalance')).toEqual([]);
    const s = scanAndSummarize(d);
    expect(s.unbalanceViolationCount).toBeGreaterThan(0);
    expect(s.voltageViolationCount).toBe(3); // voltage ranking unaffected
  });

  it('the scan summary reports the worst VUF over the day, with where and when', () => {
    const s = scanAndSummarize(walkthroughIsland());
    expect(s.worstVuf).toMatchObject({ pole: 'P3', year: 0 });
    expect(s.unbalanceViolationCount).toBe(0);
  });

  it('withDefaults gives older designs the standards group, filling missing fields only', () => {
    const { standards, ...old } = walkthroughIsland();
    expect(withDefaults(old).standards).toMatchObject({ vufLimitPct: 2, vufAsViolation: false });
    expect(withDefaults({ ...old, standards: { vufLimitPct: 3 } }).standards).toMatchObject({ vufLimitPct: 3, vufAsViolation: false });
    expect(defaultDesign().standards).toMatchObject({ vufLimitPct: 2, vufAsViolation: false });
  });
});
