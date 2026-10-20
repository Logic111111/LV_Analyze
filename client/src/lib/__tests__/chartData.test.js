import { describe, it, expect } from 'vitest';
import { runSnapshot, runDailyScan, faultLevels, conductorParams, C, PHASES, proposePhaseBalance, applyPhaseBalance } from '../loadflow.js';
import { phasorData, voltageHeatmap, loadingDuration, vufByPole, faultAlongFeeder } from '../chartData.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';

// P5.3 — chart data.

describe('neutral shift and phasors', () => {
  const d = walkthroughIsland();
  const res = runSnapshot(d, { year: 0, hour: 20, solarMult: 0 });

  it('at the first pole the neutral shift is Zn·In of span 1 (ungrounded island)', () => {
    const p1 = res.poleResults.find(p => p.id === 'P1');
    const pole = d.poles.find(p => p.id === 'P1'), cp = conductorParams(d, pole.cond), km = pole.spanM / 1000;
    expect(C.abs(p1.vn)).toBeCloseTo(Math.hypot(cp.Rn * km, cp.Xn * km) * p1.In, 9);
  });

  it('the shift grows along the feeder, and phase tips are phase-to-neutral + shift', () => {
    const [p1, p2, p3] = ['P1', 'P2', 'P3'].map(id => res.poleResults.find(p => p.id === id));
    expect(C.abs(p3.vn)).toBeGreaterThan(C.abs(p2.vn));
    expect(C.abs(p2.vn)).toBeGreaterThan(C.abs(p1.vn));
    const ph = phasorData(p3);
    PHASES.forEach(k => {
      expect(C.abs(C.sub(ph.tips[k], ph.neutral))).toBeCloseTo(p3.volt[k], 9);
      expect(ph.toNeutral[k].mag).toBeCloseTo(p3.volt[k], 9);
    });
    expect(ph.neutralShiftV).toBeGreaterThan(1); // 30.5 / 8 / 8.5 kVA unbalance at 20:00
  });

  it('balancing the phases shrinks the neutral shift at the far pole', () => {
    const bal = applyPhaseBalance(d, proposePhaseBalance(d, 'TX').changed);
    const r2 = runSnapshot(bal, { year: 0, hour: 20, solarMult: 0 });
    expect(C.abs(r2.poleResults.find(p => p.id === 'P3').vn)).toBeLessThan(C.abs(res.poleResults.find(p => p.id === 'P3').vn));
  });

  it('a grounded pole reports its neutral relative to the star point from the nodal solve', () => {
    const g = { ...d, poles: d.poles.map(p => (p.id === 'P3' ? { ...p, grounded: true, groundOhms: 10 } : p)) };
    const r = runSnapshot(g, { year: 0, hour: 20, solarMult: 0 });
    r.poleResults.forEach(p => expect(Number.isFinite(C.abs(p.vn))).toBe(true));
  });
});

describe('scan charts', () => {
  const d = walkthroughIsland();
  const daily = runDailyScan(d, 0);

  it('heatmap: 3 rows per pole × 24 hours, matching the scan', () => {
    const h = voltageHeatmap(daily);
    expect(h.rows).toHaveLength(d.poles.length * 3);
    expect(h.hours).toEqual([...Array(24).keys()]);
    const row = h.rows.find(r => r.pole === 'P3' && r.phase === 'A');
    expect(row.values[20]).toBe(daily[20].poleResults.find(p => p.id === 'P3').volt.A);
  });

  it('loading-duration curves are sorted high to low and keep every hour', () => {
    const ld = loadingDuration(daily);
    expect(ld.transformers).toHaveLength(1);
    expect(ld.spans).toHaveLength(d.poles.length);
    [...ld.transformers, ...ld.spans].forEach(s => {
      expect(s.values).toHaveLength(24);
      for (let i = 1; i < 24; i++) expect(s.values[i]).toBeLessThanOrEqual(s.values[i - 1]);
    });
    expect(ld.transformers[0].values[0]).toBe(Math.max(...daily.map(r => r.transformers[0].txPct)));
  });

  it('VUF by pole, with the daily maximum', () => {
    const v = vufByPole(daily[20], daily);
    expect(v.map(x => x.pole)).toEqual(['P1', 'P2', 'P3']);
    v.forEach(x => expect(x.dailyMax).toBeGreaterThanOrEqual(x.vuf));
  });

  it('fault level falls along the feeder (from the LV bus outwards)', () => {
    const paths = faultAlongFeeder(faultLevels(d), d);
    expect(paths).toHaveLength(1);
    const pts = paths[0].points;
    expect(pts[0].distanceM).toBe(0);
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i].distanceM).toBeGreaterThan(pts[i - 1].distanceM);
      expect(pts[i].ik3kA).toBeLessThan(pts[i - 1].ik3kA);
      expect(pts[i].ik1kA).toBeLessThan(pts[i].ik3kA);
    }
  });
});
