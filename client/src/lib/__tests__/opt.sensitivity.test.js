import { describe, it, expect } from 'vitest';
import { withDefaults, runSnapshot, networkJacobian, finiteDifferenceJacobian, jacobianAt, semiAnalyticSupported } from '../loadflow.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';
import { syntheticFeeder } from './fixtures/syntheticFeeder.js';

// O1.3 — the semi-analytic Jacobian against central finite differences (two full load flows per
// location), and its linear predictions against full load flows.
//
// Finite differences carry the solver's own stopping error (1e-4 V per iteration, i.e. about
// 1e-4 V/kW over a ±0.5 kW step), so a relative comparison is only meaningful where the
// derivative is well above that: entries under 0.02 V/kW are compared in absolute terms instead.
// A span carrying no current on a phase has a kink there (|I| at 0); the semi-analytic model
// takes |ΔI| (the conservative side, used by the hosting LP) where central differences give ~0,
// so such spans are not compared.
const PH = ['A', 'B', 'C'];
const allLocations = (d) => d.poles.flatMap(p => PH.map(ph => ({ pole: p.id, phase: ph })));

function compare(d, hour) {
  const so = { year: 0, hour, loadMult: 1, solarMult: 1 };
  const base = runSnapshot(d, so);
  const locs = allLocations(d);
  const an = networkJacobian(d, base, locs);
  const fd = finiteDifferenceJacobian(d, so, locs, { base });
  const fdV = new Map(fd.volt.map(v => [v.pole + v.phase, v])), fdS = new Map(fd.spans.map(v => [v.pole + v.phase, v]));
  let rel = 0, abs = 0, span = 0, tx = 0;
  an.volt.forEach(v => v.grad.forEach((g, i) => {
    const f = fdV.get(v.pole + v.phase).grad[i], e = Math.abs(g - f);
    if (Math.abs(f) > 0.02) rel = Math.max(rel, e / Math.abs(f)); else abs = Math.max(abs, e);
  }));
  an.spans.forEach(v => v.grad.forEach((g, i) => {
    const f = fdS.get(v.pole + v.phase).grad[i];
    if (v.pct > 20 && Math.abs(f) > 0.05) span = Math.max(span, Math.abs(g - f) / Math.abs(f));
  }));
  an.tx.forEach((t, ti) => t.grad.forEach((g, i) => { const f = fd.tx[ti].grad[i]; if (Math.abs(f) > 0.01) tx = Math.max(tx, Math.abs(g - f) / Math.abs(f)); }));
  return { rel, abs, span, tx, base, an };
}

describe('networkJacobian (semi-analytic)', () => {
  it.each([12, 20])('matches finite differences within 2 %% on the fixture at %i:00', (hour) => {
    const r = compare(withDefaults(walkthroughIsland()), hour);
    expect(r.an.method).toBe('semi-analytic');
    expect(r.rel).toBeLessThanOrEqual(0.02);
    expect(r.abs).toBeLessThanOrEqual(5e-4);
    expect(r.span).toBeLessThanOrEqual(0.02);
    expect(r.tx).toBeLessThanOrEqual(0.02);
  });
  it('matches finite differences on the 50-pole synthetic feeder', () => {
    const r = compare(withDefaults(syntheticFeeder()), 20);
    expect(r.rel).toBeLessThanOrEqual(0.02);
    expect(r.abs).toBeLessThanOrEqual(5e-4);
    expect(r.tx).toBeLessThanOrEqual(0.02);
    expect(r.span).toBeLessThanOrEqual(0.05);
  });
  it('predicts ±1 kVA changes within 0.2 V of a full load flow', () => {
    const d = withDefaults(walkthroughIsland());
    for (const hour of [12, 20]) {
      const so = { year: 0, hour, loadMult: 1, solarMult: 1 };
      const base = runSnapshot(d, so);
      const locs = allLocations(d);
      const j = networkJacobian(d, base, locs);
      locs.forEach((loc, li) => {
        for (const kva of [1, -1]) {
          const full = runSnapshot(d, { ...so, extraS: [{ pole: loc.pole, phase: loc.phase, p: -kva, q: 0 }] });
          j.volt.forEach(v => {
            const actual = full.poleResults.find(p => p.id === v.pole).volt[v.phase];
            expect(Math.abs(v.value + v.grad[li] * kva - actual)).toBeLessThanOrEqual(0.2);
          });
        }
      });
    }
  });
  it('injecting on one phase moves the other two through the shared neutral', () => {
    const d = withDefaults(walkthroughIsland());
    const j = networkJacobian(d, runSnapshot(d, { year: 0, hour: 12, loadMult: 1, solarMult: 1 }), [{ pole: 'P3', phase: 'A' }]);
    const g = (ph) => j.volt.find(v => v.pole === 'P3' && v.phase === ph).grad[0];
    expect(g('A')).toBeGreaterThan(0);  // generation raises its own phase
    expect(g('B')).toBeLessThan(0);     // and the neutral rise pulls the others down
    expect(g('C')).toBeLessThan(0);
  });
  it('falls back to finite differences for earthed poles', () => {
    const d = withDefaults(syntheticFeeder({ grounded: true }));
    const so = { year: 0, hour: 12, loadMult: 1, solarMult: 1 };
    const base = runSnapshot(d, so);
    expect(semiAnalyticSupported(d, base)).toBe(false);
    expect(jacobianAt(d, so, [{ pole: d.poles[3].id, phase: 'A' }], { base }).method).toBe('finite-difference');
  });
});
