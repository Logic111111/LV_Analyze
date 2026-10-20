import { describe, it, expect } from 'vitest';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';

// Guards the fixture itself: if someone edits defaultDesign() or the fixture builder, every golden
// downstream would shift for a reason unrelated to the engine. Failing here first makes that obvious.
describe('Walkthrough Island fixture', () => {
  const d = walkthroughIsland();

  it('has one 100 kVA transformer on tap 2 with a 10.8 kV supply', () => {
    expect(d.transformers).toHaveLength(1);
    expect(d.transformers[0]).toMatchObject({ id: 'TX', txRating: 100, tap: 2, hvActual: 10800, txXR: 3, txGroundOhms: 7.5 });
  });

  it('has the three-pole feeder with 40 / 60 / 60 m spans', () => {
    expect(d.poles.map(p => [p.id, p.parent, p.spanM, p.cond])).toEqual([
      ['P1', 'TX', 40, '70ABC'], ['P2', 'P1', 60, '70ABC'], ['P3', 'P2', 60, '50ABC']
    ]);
  });

  it('has 18 connections in the fixed order L1..L18', () => {
    expect(d.loads.map(l => l.id)).toEqual(Array.from({ length: 18 }, (_, i) => 'L' + (i + 1)));
    expect(d.loads.slice(6, 11).every(l => l.pole === 'P2' && l.phase === 'A' && l.type === 'general')).toBe(true);
    expect(d.loads.slice(11, 17).every(l => l.pole === 'P3' && l.phase === 'A' && l.type === 'general')).toBe(true);
    expect(d.loads[17]).toEqual({ id: 'L18', pole: 'P3', type: 'ev', phase: 'A', kva: 7 });
  });

  it('keeps the two default PV systems and no BESS', () => {
    expect(d.pv.map(p => [p.id, p.pole, p.phase, p.kva])).toEqual([['S1', 'P2', 'A', 4], ['S2', 'P3', 'B', 5]]);
    expect(d.bess).toEqual([]);
  });
});
