import { describe, it, expect } from 'vitest';
import {
  interpolateCurve, inverterOutput, inverterSettings, IEEE1547_CAT_B, runSnapshot, runDailyScan,
  computeHostingCapacity, HOSTING_TEST_HOURS, withDefaults
} from '../loadflow.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';
import { balancedIsland } from './fixtures/referenceCases.js';
import { poleResult } from './helpers.js';

// P3.1 — smart-inverter PV.

const withMode = (d, mode, extra = {}) => ({ ...d, inverter: { ...withDefaults(d).inverter, mode, ...extra } });
const NOON_BIG = { year: 0, hour: 12, solarMult: 1, extraPV: [{ pole: 'P3', phase: 'B', kva: 8 }] };

describe('curves and the unit response', () => {
  it('interpolates breakpoints linearly and holds flat beyond the ends (IEEE 1547 Cat B volt-var)', () => {
    const vv = IEEE1547_CAT_B.voltVarCurve;
    expect(interpolateCurve(vv, 0.90)).toBe(0.44);
    expect(interpolateCurve(vv, 0.95)).toBeCloseTo(0.22, 12);
    expect(interpolateCurve(vv, 1.00)).toBe(0);
    expect(interpolateCurve(vv, 1.05)).toBeCloseTo(-0.22, 12);
    expect(interpolateCurve(vv, 1.20)).toBe(-0.44);
  });

  it('volt-watt curtails P between 1.06 and 1.10 pu (to 0.2 of rating)', () => {
    const s = inverterSettings({ inverter: { mode: 'voltWatt' } });
    expect(inverterOutput({ kva: 5, pAvail: 5, mode: 'voltWatt' }, 1.05, s)).toEqual({ p: 5, q: 0 });
    expect(inverterOutput({ kva: 5, pAvail: 5, mode: 'voltWatt' }, 1.07, s).p).toBeCloseTo(4, 12); // 1 − 0.25 × 0.8 = 0.8
    expect(inverterOutput({ kva: 5, pAvail: 5, mode: 'voltWatt' }, 1.2, s).p).toBeCloseTo(1, 12);
  });

  it('reactive priority: P is reduced so P² + Q² stays within the rating; export limit caps P', () => {
    const s = inverterSettings({ inverter: { mode: 'voltVar' } });
    const o = inverterOutput({ kva: 5, pAvail: 5, mode: 'voltVar' }, 1.08, s);
    expect(o.q).toBeCloseTo(-2.2, 12);
    expect(o.p * o.p + o.q * o.q).toBeCloseTo(25, 9);
    const lim = inverterSettings({ inverter: { mode: 'unity', exportLimitKw: 3 } });
    expect(inverterOutput({ kva: 5, pAvail: 5, mode: 'unity' }, 1.0, lim)).toEqual({ p: 3, q: 0 });
  });
});

describe('in the load flow', () => {
  it('unity mode (the default) changes nothing — bit-identical to a design with no inverter settings', () => {
    const { inverter, ...bare } = walkthroughIsland();
    const opts = { year: 0, hour: 12, solarMult: 1.5 };
    expect(runSnapshot(withMode(walkthroughIsland(), 'unity'), opts)).toEqual(runSnapshot(bare, opts));
    expect(runSnapshot(withMode(walkthroughIsland(), 'unity'), opts).poleResults.every(p => p.inverters.length === 0)).toBe(true);
  });

  it('volt-watt lowers the voltage rise of a large PV and reports the curtailment', () => {
    const d = balancedIsland();
    const unity = runSnapshot(d, NOON_BIG);
    const vw = runSnapshot(withMode(d, 'voltWatt'), NOON_BIG);
    expect(vw.converged).toBe(true);
    expect(poleResult(vw, 'P3').volt.B).toBeLessThan(poleResult(unity, 'P3').volt.B - 1);
    const units = poleResult(vw, 'P3').inverters;
    expect(units.length).toBe(2); // S2 and the extra 8 kVA unit
    units.forEach(u => { expect(u.curtailedKw).toBeGreaterThan(0); expect(u.qKvar).toBe(0); });
  });

  it('volt-var absorbs reactive power at high voltage', () => {
    const r = runSnapshot(withMode(balancedIsland(), 'voltVar'), NOON_BIG);
    expect(r.converged).toBe(true);
    poleResult(r, 'P3').inverters.forEach(u => expect(u.qKvar).toBeLessThan(0));
  });

  it('a per-PV override beats the design mode', () => {
    const d = withMode(balancedIsland(), 'unity');
    d.pv = d.pv.map(p => (p.id === 'S2' ? { ...p, inverterMode: 'voltVar' } : p));
    const r = runSnapshot(d, { year: 0, hour: 12, solarMult: 1.5 });
    expect(poleResult(r, 'P3').inverters.map(u => [u.id, u.mode])).toEqual([['S2', 'voltVar']]);
  });

  it('convergence holds over a full day in every smart mode, with heavy PV', () => {
    ['voltVar', 'voltWatt', 'voltVarWatt'].forEach(mode => {
      const d = withMode(walkthroughIsland(), mode);
      d.pv = [...d.pv, { id: 'BIG', pole: 'P3', phase: 'C', kva: 12 }];
      expect(runDailyScan(d, 0).every(r => r.converged)).toBe(true);
    });
  });
});

describe('hosting with smart inverters (brief: volt-watt on the balanced island)', () => {
  it('P3-B hosting ≥ 2.70 kVA, and no hour exceeds the upper limit at the found size', () => {
    const d = withMode(balancedIsland(), 'voltWatt');
    const row = computeHostingCapacity(d).find(r => r.pole === 'P3' && r.phase === 'B');
    expect(row.kva).toBeGreaterThanOrEqual(2.70);
    HOSTING_TEST_HOURS.forEach(h => {
      const r = runSnapshot(d, { year: 0, hour: h, extraPV: [{ pole: 'P3', phase: 'B', kva: row.kva }] });
      expect(r.converged).toBe(true);
      r.poleResults.forEach(p => ['A', 'B', 'C'].forEach(ph => expect(p.volt[ph]).toBeLessThanOrEqual(r.vLimHigh + 1e-9)));
    });
  });

  it('volt-var raises it further (4.6 kVA at P3-B)', () => {
    const row = computeHostingCapacity(withMode(balancedIsland(), 'voltVar')).find(r => r.pole === 'P3' && r.phase === 'B');
    expect(row.kva).toBeCloseTo(4.6, 9);
  });
});
