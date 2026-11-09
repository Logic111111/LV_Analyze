import { describe, it, expect } from 'vitest';
import { withVoltages, headline, tableRows } from '../../compare/compareData.js';

// The comparison app's pure helpers: everything on its screen comes from the OpenDSS check's answer.
const res = {
  poleResults: [{ id: 'P1', volt: { A: 1, B: 1, C: 1 }, condPct: { A: 5, B: 5, C: 5 } }, { id: 'P2', volt: { A: 1, B: 1, C: 1 } }],
  transformers: [{ id: 'T1', busVoltPct: { A: 1, B: 1, C: 1 }, txPct: 40 }, { id: 'T2', busVoltPct: { A: 1, B: 1, C: 1 } }]
};
const points = [['T1', 'A', 240, 240.001], ['P1', 'A', 230, 229.9], ['P1', 'B', 231, 231.0005], ['T2', 'C', 239, 238.99]];
const check = { losses: { appW: 1500, dssW: 1499 }, points, currents: [['P1', 'A', 9, 9.1], ['P1', 'N', 4, 4.2], ['P2', 'N', 6, 5.9]], transformers: [['T1', 60, 60.002], ['T2', 30, 29.999]] };

describe('withVoltages', () => {
  it('puts the chosen tool\'s voltage on each pole and transformer bus, leaving the rest and the input alone', () => {
    const before = JSON.stringify(res);
    const dss = withVoltages(res, points, 3);
    expect(dss.poleResults[0].volt).toEqual({ A: 229.9, B: 231.0005, C: 1 });
    expect(dss.poleResults[1].volt).toEqual({ A: 1, B: 1, C: 1 });
    expect(dss.transformers[0].busVoltPct.A).toBe(240.001);
    expect(dss.transformers[1].busVoltPct.C).toBe(238.99);
    expect(dss.poleResults[0].condPct).toEqual({ A: 5, B: 5, C: 5 });
    expect(withVoltages(res, points, 2).poleResults[0].volt.A).toBe(230);
    expect(JSON.stringify(res)).toBe(before);
  });
});

describe('headline', () => {
  it('pairs each card\'s value from both tools, one transformer line each', () => {
    const h = headline(check);
    expect(h.lossKW).toEqual({ app: 1.5, dss: 1.499 });
    expect(h.minV).toEqual({ app: 230, dss: 229.9 });
    expect(h.maxV).toEqual({ app: 240, dss: 240.001 });
    expect(h.neutralA).toEqual({ app: 6, dss: 5.9 });
    expect(h.transformers).toEqual([{ id: 'T1', app: 60, dss: 60.002 }, { id: 'T2', app: 30, dss: 29.999 }]);
  });
  it('gives null, not Infinity, when there is nothing to take a value from', () => {
    const h = headline({ ...check, points: [], currents: [['P1', 'A', 9, 9]] });
    expect(h.minV).toEqual({ app: null, dss: null });
    expect(h.maxV).toEqual({ app: null, dss: null });
    expect(h.neutralA).toEqual({ app: null, dss: null });
  });
});

describe('tableRows', () => {
  it('lists every point with its difference in mV, largest first', () => {
    const rows = tableRows(points);
    expect(rows.map(r => r.id + r.phase)).toEqual(['P1A', 'T2C', 'T1A', 'P1B']);
    expect(rows[0].diffMV).toBeCloseTo(100, 6);
    expect(rows[3]).toMatchObject({ id: 'P1', phase: 'B', app: 231, dss: 231.0005 });
  });
});
