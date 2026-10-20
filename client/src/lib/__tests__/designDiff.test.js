import { describe, it, expect } from 'vitest';
import { designDiff } from '../designDiff.js';
import { applyPhaseBalance, applyReconductor } from '../loadflow.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';

// P7.3 — field-level diff between two versions.
describe('designDiff', () => {
  const a = walkthroughIsland();
  it('identical designs differ in nothing; list order is not a change', () => {
    expect(designDiff(a, a).total).toBe(0);
    expect(designDiff(a, { ...a, loads: [...a.loads].reverse() }).total).toBe(0);
  });
  it('reports settings, moved connections, re-strung spans, additions and removals', () => {
    let b = applyPhaseBalance(a, [{ id: 'L18', newPhase: 'B' }]);
    b = applyReconductor(b, [{ pole: 'P3', to: '70ABC' }]);
    b = { ...b, admd: 2, pv: [...b.pv, { id: 'PVX', pole: 'P1', phase: 'A', kva: 3 }], loads: b.loads.filter(l => l.id !== 'L1') };
    const d = designDiff(a, b);
    expect(d.settings).toEqual([{ field: 'admd', from: String(a.admd), to: '2' }]);
    expect(d.items).toEqual(expect.arrayContaining([
      { kind: 'Load', id: 'L18', change: 'changed', fields: ['phase A→B'] },
      { kind: 'Pole', id: 'P3', change: 'changed', fields: ['cond 50ABC→70ABC'] },
      { kind: 'PV', id: 'PVX', change: 'added' },
      { kind: 'Load', id: 'L1', change: 'removed' }
    ]));
    expect(d.total).toBe(5);
  });
});
