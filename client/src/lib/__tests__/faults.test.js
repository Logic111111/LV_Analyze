import { describe, it, expect } from 'vitest';
import {
  faultLevels, sourceImpedance, faultSettings, protectionCheck, protectionDevices, feederFuseKey,
  ALPHA_AL_PER_K, runDailyScan, C, txImpedance, withDefaults
} from '../loadflow.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';
import { expectGolden } from './helpers.js';

// P2.3 — fault levels (IEC 60909-style) and the fuse protection check.

// The brief's golden conditions: c = 1, conductors at 20 °C, infinite source.
const goldenDesign = () => ({ ...walkthroughIsland(), fault: { hvFaultMVA: null, hvXR: 10, cMax: 1, cMin: 1, condTempC: 20 } });

describe('golden: fault levels (cMin = cMax = 1, 20 °C, infinite source)', () => {
  const fl = faultLevels(goldenDesign());
  const p3 = fl.poles.find(p => p.id === 'P3');

  it('|Zloop(P3)| = 0.24096 Ω (R 0.22151, X 0.09484)', () => {
    expectGolden(C.abs(p3.zLoop), 0.24096, 5, '|Zloop|', 5e-6);
    expectGolden(p3.zLoop.re, 0.22151, 5, 'R', 5e-6);
    expectGolden(p3.zLoop.im, 0.09484, 5, 'X', 5e-6);
  });

  it('Ik1 at P3 = 954.5 A', () => {
    expectGolden(p3.ik1MinA, 954.5, 1, 'Ik1 P3');
  });

  it('Ik3 at the transformer LV terminals = 3338.7 A', () => {
    expectGolden(fl.transformers[0].ik3MaxA, 3338.7, 1, 'Ik3 TX');
  });
});

describe('fault level method', () => {
  it('defaults: cMax 1.05, cMin 0.95, 80 °C, infinite source, X/R 10', () => {
    expect(faultSettings(withDefaults(walkthroughIsland()))).toEqual({ hvFaultMVA: null, hvXR: 10, cMax: 1.05, cMin: 0.95, condTempC: 80 });
  });

  it('conductor temperature scales line R by 1 + α(θ − 20) for the loop, X unchanged', () => {
    const d = goldenDesign();
    const at20 = faultLevels(d).poles.find(p => p.id === 'P3');
    const at80 = faultLevels({ ...d, fault: { ...d.fault, condTempC: 80 } }).poles.find(p => p.id === 'P3');
    const t = txImpedance(d.transformers[0], d);
    const k = 1 + ALPHA_AL_PER_K * 60; // 1.2418
    expect(at80.zLoop.re - t.r).toBeCloseTo((at20.zLoop.re - t.r) * k, 12);
    expect(at80.zLoop.im).toBeCloseTo(at20.zLoop.im, 12);
    expect(at80.ik3MaxA).toBeCloseTo(at20.ik3MaxA, 12); // the maximum fault stays at 20 °C
  });

  it('source impedance: Zq = cMax·U_LL²/S″k split by X/R (10 MVA, X/R 10 → 16.66 mΩ)', () => {
    const d = { ...walkthroughIsland(), fault: { hvFaultMVA: 10, hvXR: 10, cMax: 1.05, cMin: 0.95, condTempC: 80 } };
    const zq = sourceImpedance(d);
    const uLL = Math.sqrt(3) * 230;
    expect(C.abs(zq)).toBeCloseTo(1.05 * uLL * uLL / 10e6, 12);
    expect(zq.im / zq.re).toBeCloseTo(10, 12);
    const t = txImpedance(d.transformers[0], d);
    expect(faultLevels(d).transformers[0].ik3MaxA).toBeCloseTo(1.05 * 230 / C.abs(C.add(zq, { re: t.r, im: t.x })), 9);
    expect(C.abs(sourceImpedance(walkthroughIsland()))).toBe(0); // no fault group → infinite source
  });

  it('fault currents fall along the feeder, and the minimum single-phase is below the maximum three-phase', () => {
    const fl = faultLevels(withDefaults(walkthroughIsland()));
    const ids = ['P1', 'P2', 'P3'].map(id => fl.poles.find(p => p.id === id));
    expect(ids[0].ik3MaxA).toBeGreaterThan(ids[1].ik3MaxA);
    expect(ids[1].ik1MinA).toBeGreaterThan(ids[2].ik1MinA);
    ids.forEach(p => expect(p.ik1MinA).toBeLessThan(p.ik3MaxA));
    expect(ids.map(p => p.distanceM)).toEqual([40, 100, 160]);
  });
});

// FICTITIOUS test fuse — invented numbers that exist only to exercise the check logic. The app
// ships no fuse data; real Ia / breaking values must come from the user's manufacturer curves.
const TEST_FUSE = { id: 'TEST100', ratingA: 100, type: 'TEST ONLY', ia5sA: 500, ia04sA: 1000, breakingKA: 50, source: 'fictitious, for tests' };

describe('protection check', () => {
  const scan = (d) => runDailyScan(d, 0);

  it('with an empty fuse library every check is "missing", never pass or fail', () => {
    const d = withDefaults(walkthroughIsland());
    const r = protectionCheck(d, scan(d));
    expect(r.fuseLibraryEmpty).toBe(true);
    expect(r.devices).toHaveLength(1);
    expect(r.devices[0]).toMatchObject({ kind: 'feeder', key: feederFuseKey('TX', 'F1'), fuseId: null, overall: 'missing' });
    Object.values(r.devices[0].checks).forEach(c => expect(c.status).toBe('missing'));
  });

  it('a head fuse is checked on all four counts (hand-checkable outcomes)', () => {
    const d = withDefaults(walkthroughIsland());
    d.fuseLibrary = [TEST_FUSE];
    d.protection = { feederFuses: { [feederFuseKey('TX', 'F1')]: 'TEST100' }, poleFuses: {} };
    const r = protectionCheck(d, scan(d));
    const dev = r.devices[0];
    const fl = faultLevels(d);
    const ik1P3 = fl.poles.find(p => p.id === 'P3').ik1MinA;
    expect(dev.zonePoles).toEqual(['P1', 'P2', 'P3']);
    expect(dev.minIk1A).toBe(ik1P3);
    // (a) 5 s: Ia 500 A < Ik1min at P3 (~800 A) → pass
    expect(dev.checks.disconnection.status).toBe('pass');
    // (b) Ik3max at the transformer (~3.5 kA) ≤ 50 kA → pass
    expect(dev.ik3AtDeviceA).toBe(fl.transformers[0].ik3MaxA);
    expect(dev.checks.breaking.status).toBe('pass');
    // (c) peak phase current through P1's span over the day (>120 A at the evening peak) > 100 A → fail
    expect(dev.peakCurrentA).toBeGreaterThan(120);
    expect(dev.checks.load.status).toBe('fail');
    // (d) 100 A ≤ Iz of the first span (70ABC, 203 A) → pass
    expect(dev.izA).toBe(203);
    expect(dev.checks.cable.status).toBe('pass');
    expect(dev.overall).toBe('fail');
  });

  it('the 0.4 s disconnection time uses Ia(0.4 s); a missing value is "missing"', () => {
    const d = withDefaults(walkthroughIsland());
    d.standards = { ...d.standards, disconnectTimeS: 0.4 };
    d.fuseLibrary = [TEST_FUSE, { ...TEST_FUSE, id: 'NO04', ia04sA: null }];
    d.protection = { feederFuses: { [feederFuseKey('TX', 'F1')]: 'TEST100' }, poleFuses: {} };
    const r = protectionCheck(d, scan(d));
    expect(r.disconnectTimeS).toBe(0.4);
    expect(r.devices[0].checks.disconnection.status).toBe('fail'); // Ia 1000 A > Ik1min at P3
    d.protection.feederFuses[feederFuseKey('TX', 'F1')] = 'NO04';
    expect(protectionCheck(d, scan(d)).devices[0].checks.disconnection.status).toBe('missing');
  });

  it('a section fuse at P3 takes P3 out of the head fuse zone; its fault level is at P2', () => {
    const d = withDefaults(walkthroughIsland());
    d.fuseLibrary = [TEST_FUSE];
    d.protection = { feederFuses: { [feederFuseKey('TX', 'F1')]: 'TEST100' }, poleFuses: { P3: 'TEST100' } };
    const devs = protectionDevices(d);
    expect(devs.map(x => [x.kind, x.zonePoles])).toEqual([['feeder', ['P1', 'P2']], ['pole', ['P3']]]);
    const r = protectionCheck(d, scan(d));
    const sect = r.devices.find(x => x.kind === 'pole');
    expect(sect.locationNode).toBe('P2');
    expect(sect.ik3AtDeviceA).toBe(faultLevels(d).poles.find(p => p.id === 'P2').ik3MaxA);
    expect(sect.izA).toBe(162); // first span into P3 is 50ABC
  });

  it('a fuse id that is not in the library is reported, not crashed on', () => {
    const d = withDefaults(walkthroughIsland());
    d.protection = { feederFuses: { [feederFuseKey('TX', 'F1')]: 'GONE' }, poleFuses: {} };
    const r = protectionCheck(d, scan(d));
    expect(r.devices[0].checks.load).toMatchObject({ status: 'missing' });
    expect(r.devices[0].checks.load.detail).toMatch(/"GONE" is not in the fuse library/);
  });

  it('never touches the load-flow violations hosting and the advisors rank on', () => {
    const d = withDefaults(walkthroughIsland());
    d.fuseLibrary = [TEST_FUSE];
    d.protection = { feederFuses: { [feederFuseKey('TX', 'F1')]: 'TEST100' }, poleFuses: {} };
    const s = scan(d);
    const before = JSON.stringify(s.map(r => r.violations));
    protectionCheck(d, s);
    expect(JSON.stringify(s.map(r => r.violations))).toBe(before);
    expect(s.flatMap(r => r.violations).every(v => ['undervoltage', 'overvoltage', 'thermal', 'transformer overload'].includes(v.type))).toBe(true);
  });
});
