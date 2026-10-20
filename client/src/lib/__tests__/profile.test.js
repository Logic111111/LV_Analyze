import { describe, it, expect } from 'vitest';
import { distanceFromTx, voltageProfile, runSnapshot } from '../loadflow.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';
import { syntheticFeeder } from './fixtures/syntheticFeeder.js';

// P2.2 — distance from the transformer, and voltage-vs-distance profile data.

describe('distanceFromTx', () => {
  it('sums the spans back to the transformer (fixture: 40 / 60 / 60 m)', () => {
    const d = walkthroughIsland();
    expect(distanceFromTx(d, 'P1')).toBe(40);
    expect(distanceFromTx(d, 'P2')).toBe(100);
    expect(distanceFromTx(d, 'P3')).toBe(160);
  });

  it('rejects an unknown pole', () => {
    expect(() => distanceFromTx(walkthroughIsland(), 'NOPE')).toThrow(/not in the design/);
  });
});

describe('voltageProfile', () => {
  it('Walkthrough Island: one path, bus at 0 m then P1/P2/P3, voltages from the snapshot', () => {
    const d = walkthroughIsland();
    const r = runSnapshot(d, { year: 0, hour: 20, solarMult: 0 });
    const paths = voltageProfile(r, d);
    expect(paths).toHaveLength(1);
    const pts = paths[0].points;
    expect(pts.map(p => [p.poleId, p.distanceM, p.isBus])).toEqual([['TX', 0, true], ['P1', 40, false], ['P2', 100, false], ['P3', 160, false]]);
    expect(pts[0].A).toBe(r.transformers[0].busVoltPct.A);
    expect(pts[3]).toMatchObject({ A: r.poleResults[2].volt.A, B: r.poleResults[2].volt.B, C: r.poleResults[2].volt.C });
  });

  it('a branchy feeder gives one path per leaf, each following parents outwards with rising distance', () => {
    const d = syntheticFeeder();
    const r = runSnapshot(d, { year: 0, hour: 20 });
    const all = voltageProfile(r, d);
    const leaves = d.poles.filter(p => !d.poles.some(q => q.parent === p.id)).map(p => p.id);
    expect(all.map(p => p.leafPoleId).sort()).toEqual(leaves.sort());
    all.forEach(path => {
      for (let i = 1; i < path.points.length; i++) {
        expect(path.points[i].distanceM).toBeGreaterThanOrEqual(path.points[i - 1].distanceM);
        if (i > 1) expect(d.poles.find(p => p.id === path.points[i].poleId).parent).toBe(path.points[i - 1].poleId);
      }
      expect(path.points[path.points.length - 1].distanceM).toBe(distanceFromTx(d, path.leafPoleId));
    });
  });

  it('feederRoot limits to one feeder; path gives exactly that path', () => {
    const d = syntheticFeeder();
    const r = runSnapshot(d, { year: 0, hour: 20 });
    const f1 = voltageProfile(r, d, { feederRoot: 'P1' });
    expect(f1.length).toBeGreaterThan(0);
    expect(f1.every(p => p.rootPoleId === 'P1')).toBe(true);
    const one = voltageProfile(r, d, { path: f1[0].points.slice(1).map(p => p.poleId) });
    expect(one).toEqual([f1[0]]);
  });

  it('rejects a path that does not follow the feeder', () => {
    const d = walkthroughIsland();
    const r = runSnapshot(d, { year: 0, hour: 20 });
    expect(() => voltageProfile(r, d, { path: ['P1', 'P3'] })).toThrow(/not fed from "P1"/);
    expect(() => voltageProfile(r, d, { path: ['P2', 'P3'] })).toThrow(/feeder root/);
  });
});
