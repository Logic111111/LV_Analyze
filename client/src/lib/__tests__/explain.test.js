import { describe, it, expect } from 'vitest';
import {
  runSnapshot, faultLevels, computeHostingCapacity, traceHostingSearch,
  explainPoleVoltage, explainSpanLoading, explainSpanLoss, explainTxLoading, explainFault, explainVuf, explainHosting,
  PHASES, conductorParams, diagonalZMatrix
} from '../loadflow.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';

// P5.6 — "explain this number" traces add up to the reported results.

const d = walkthroughIsland();
const res = runSnapshot(d, { year: 0, hour: 20, solarMult: 0 });

describe('explain traces', () => {
  it.each(['P1', 'P2', 'P3'].flatMap(p => PHASES.map(ph => [p, ph])))('pole voltage %s %s: V0 − drops equals the load flow (golden P3 A 212.9 V)', (pole, ph) => {
    const t = explainPoleVoltage(d, res, pole, ph);
    expect(Math.abs(t.result.value - t.check.value)).toBeLessThan(1e-3);
    expect(t.steps[0].label).toBe('No-load LV phase voltage');
    expect(t.steps.filter(s => s.label.includes(': neutral'))).toHaveLength(['P1', 'P2', 'P3'].indexOf(pole) + 1);
  });

  it('the P3 A trace shows the golden value', () => {
    expect(explainPoleVoltage(d, res, 'P3', 'A').result.value).toBeCloseTo(212.9, 1);
  });

  it('works on a grounded subtree and with the coupled model (diagonal matrices)', () => {
    const g = { ...d, poles: d.poles.map(p => (p.id === 'P2' ? { ...p, grounded: true, groundOhms: 10 } : p)) };
    const rg = runSnapshot(g, { year: 0, hour: 20, solarMult: 0 });
    PHASES.forEach(ph => { const t = explainPoleVoltage(g, rg, 'P3', ph); expect(Math.abs(t.result.value - t.check.value)).toBeLessThan(1e-3); });
    const lib = Object.fromEntries(Object.entries(d.conductorLibrary).map(([k, c]) => [k, { ...c, zMatrix: diagonalZMatrix(conductorParams(d, k)) }]));
    const cd = { ...d, lineModel: 'coupled', conductorLibrary: lib };
    const rc = runSnapshot(cd, { year: 0, hour: 20, solarMult: 0 });
    PHASES.forEach(ph => { const t = explainPoleVoltage(cd, rc, 'P3', ph); expect(Math.abs(t.result.value - t.check.value)).toBeLessThan(1e-3); });
  });

  it('span loading, span loss and transformer loading match the reported figures', () => {
    ['P1', 'P2', 'P3'].forEach(p => {
      const l = explainSpanLoading(d, res, p); expect(l.result.value).toBeCloseTo(l.check.value, 9);
      const s = explainSpanLoss(d, res, p); expect(s.result.value).toBeCloseTo(s.check.value, 6);
    });
    const t = explainTxLoading(d, res, 'TX');
    expect(t.result.value).toBeCloseTo(t.check.value, 9);
  });

  it('fault current matches faultLevels at every pole', () => {
    const fl = faultLevels(d);
    ['P1', 'P2', 'P3'].forEach(p => {
      const t = explainFault(d, p);
      const ref = fl.poles.find(x => x.id === p);
      expect(t.result.value).toBeCloseTo(ref.ik1MinA, 6);
      expect(t.steps.find(s => s.label === 'Ik3max').value).toBeCloseTo(ref.ik3MaxA, 6);
    });
  });

  it('VUF from sequence components matches the reported VUF', () => {
    ['P1', 'P2', 'P3'].forEach(p => { const t = explainVuf(res, p); expect(t.result.value).toBeCloseTo(t.check.value, 9); });
  });

  it('hosting: the traced search gives the Hosting page\'s own number for that row, and shows each try', () => {
    const row = computeHostingCapacity(d).find(r => r.limit === 'violation'); // one the bisection had to search
    const tr = traceHostingSearch(d, row.pole, row.phase);
    expect(tr.result.kva).toBe(row.kva);
    expect(tr.result.limit).toBe(row.limit);
    expect(tr.trace.length).toBeGreaterThan(3);
    expect(tr.trace[0].kva).toBe(d.maxpv); // the cap is tried first
    const t = explainHosting(tr);
    expect(t.result.value).toBe(row.kva);
    expect(t.steps.some(s => s.unit.startsWith('fails'))).toBe(true);
  });
});
