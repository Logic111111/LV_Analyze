import { describe, it, expect } from 'vitest';
import { toOpenDSS, runSnapshotAt, txImpedance, netS, connectionIndex } from '../loadflow.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';
import { syntheticFeeder } from './fixtures/syntheticFeeder.js';

// The OpenDSS export (P7.6). Agreement with OpenDSS itself is checked by
// scripts/validate-opendss.py (dev-only, needs opendssdirect.py); these pin the script's shape.
const opts = { year: 0, hour: 20, loadMult: 1, solarMult: 1 };
const lines = (s, re) => s.split('\n').filter(l => re.test(l));

describe('toOpenDSS', () => {
  it('writes the walkthrough island as a transformer, one 4-wire line per span and single-phase loads', () => {
    const d = walkthroughIsland();
    const before = JSON.stringify(d);
    const { script, buses, notes } = toOpenDSS(d, opts);
    expect(JSON.stringify(d)).toBe(before);
    expect(notes).toEqual([]);
    expect(lines(script, /^New Circuit\./)).toHaveLength(1);
    expect(lines(script, /^New Transformer\..*conns=\[delta wye\]/)).toHaveLength(1);
    expect(lines(script, /^New Line\./)).toHaveLength(d.poles.length);
    lines(script, /^New Line\./).forEach(l => expect(l).toMatch(/\.1\.2\.3\.4 .*phases=4/));
    lines(script, /^New Load\./).forEach(l => expect(l).toMatch(/phases=1 bus1=p_\w+\.[123]\.4 kV=0\.23 /));
    expect(script.trim().endsWith('Solve')).toBe(true);
    expect(Object.keys(buses.poles)).toEqual(d.poles.map(p => p.id));
  });

  it('sets the transformer so its LV-referred impedance and open-circuit voltage are the app\'s', () => {
    const d = walkthroughIsland();
    const res = runSnapshotAt(d, opts);
    const { script } = toOpenDSS(d, { ...opts, result: res });
    const t = lines(script, /^New Transformer\./)[0];
    const kvLL = Number(/kVs=\[\S+ (\S+)\]/.exec(t)[1]);
    const pctR = /%Rs=\[(\S+) (\S+)\]/.exec(t).slice(1).map(Number).reduce((a, b) => a + b, 0);
    const pctX = Number(/XHL=(\S+)/.exec(t)[1]);
    const zbase = kvLL * kvLL / (d.transformers[0].txRating / 1000);
    const z = txImpedance(d.transformers[0], d);
    expect(pctR / 100 * zbase).toBeCloseTo(z.r, 9);
    expect(pctX / 100 * zbase).toBeCloseTo(z.x, 9);
    expect(kvLL * 1000 / Math.sqrt(3)).toBeCloseTo(res.transformers[0].V0, 6);
  });

  it('exports every pole\'s injections: the kW per phase add up to the app\'s netS', () => {
    const d = syntheticFeeder();
    const o = { year: 0, hour: 12, loadMult: 1, solarMult: 1 };
    const { script } = toOpenDSS(d, o);
    const kw = lines(script, /^New Load\./).reduce((s, l) => s + Number(/kW=(\S+)/.exec(l)[1]), 0);
    const index = connectionIndex(d);
    const expected = d.poles.reduce((s, p) => {
      const inj = netS(d, p.id, 0, 12, 1, 1, [], [], index);
      return s + ['A', 'B', 'C'].reduce((t, ph) => t + inj.loadS[ph].re + inj.otherS[ph].re, 0);
    }, 0);
    expect(kw).toBeGreaterThan(0);
    expect(kw).toBeCloseTo(expected, 6);
  });

  it('earth electrodes become resistors to ground, and earthed subtrees keep the simple line model', () => {
    const d = syntheticFeeder({ grounded: true });
    const { script } = toOpenDSS({ ...d, lineModel: 'coupled' }, opts);
    const earthed = d.poles.filter(p => p.grounded && Number(p.groundOhms) > 0).length;
    expect(earthed).toBeGreaterThan(0);
    expect(lines(script, /^New Reactor\..*\.4 bus2=\S+\.0 R=/)).toHaveLength(earthed + 1);
    expect(lines(script, /^New LineCode\.lcm_/)).toHaveLength(0);
  });

  it('gives unusual ids OpenDSS-safe, unique names, and is deterministic', () => {
    const d = walkthroughIsland();
    d.poles = d.poles.map((p, i) => ({ ...p, id: i === 0 ? 'P 1' : p.id, parent: p.parent }));
    d.poles[1].parent = 'P 1';
    d.loads = d.loads.map(l => (l.pole === 'P1' ? { ...l, pole: 'P 1' } : l));
    d.poles.push({ ...d.poles[2], id: 'p_1', parent: 'P3' });
    const a = toOpenDSS(d, opts), b = toOpenDSS(d, opts);
    expect(a.script).toBe(b.script);
    expect(a.buses.poles['P 1']).toBe('p_p_1');
    expect(a.buses.poles.p_1).toBe('p_p_1_2');
  });
});
