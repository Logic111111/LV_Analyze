import { describe, it, expect } from 'vitest';
import { connectionsAtPole, fieldRecordError, mergeFieldRecords, FIELD_PHASES } from '../loadflow.js';
import { emptyFieldState, withDesignCopy, withoutDesignCopy, withRecord, withoutRecord, withForced, syncGroups, afterSync, loadFieldState, saveFieldState } from '../fieldStore.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';

// Field survey (P7.8): the merge with conflict detection by version (engine), and the phone's
// outbox (client).
const rec = (id, extra = {}) => ({ kind: 'load', id, recordedAt: '2026-10-21T08:00:00Z', ...extra });

describe('field survey merge (engine)', () => {
  const base = walkthroughIsland();
  it('lists the connections at a pole', () => {
    const at = connectionsAtPole(base, 'P3');
    expect(at.length).toBe(base.loads.filter(l => l.pole === 'P3').length + base.pv.filter(p => p.pole === 'P3').length + base.bess.filter(b => b.pole === 'P3').length);
    expect(at.every(c => ['load', 'pv', 'bess'].includes(c.kind))).toBe(true);
    expect(FIELD_PHASES).toEqual(['A', 'B', 'C', 'ABC']);
  });
  it('validates records', () => {
    expect(fieldRecordError(rec('L1'))).toBe(null);
    expect(fieldRecordError(rec('L1', { observedPhase: 'N' }))).toMatch(/observedPhase/);
    expect(fieldRecordError({ kind: 'pole', id: 'P1' })).toMatch(/kind/);
    expect(fieldRecordError(rec('L1', { recordedAt: 'yesterday' }))).toMatch(/recordedAt/);
    expect(fieldRecordError(rec('L1', { meterId: 7 }))).toMatch(/meterId/);
  });
  it('applies records on the current version, without touching the input', () => {
    const before = JSON.stringify(base);
    const id = base.loads[0].id;
    const m = mergeFieldRecords(null, base, [rec(id, { observedPhase: 'C', meterId: 'M1 ' })]);
    expect(JSON.stringify(base)).toBe(before);
    expect(m.applied).toEqual([{ kind: 'load', id }]);
    const l = m.design.loads.find(x => x.id === id);
    expect([l.phase, l.meterId, l.surveyedAt]).toEqual(['C', 'M1', '2026-10-21T08:00:00Z']);
  });
  it('detects conflicts against a newer version, and lets a forced record through', () => {
    const [a, b] = base.loads;
    const current = { ...base, loads: base.loads.map(l => (l.id === b.id ? { ...l, phase: l.phase === 'A' ? 'B' : 'A' } : l)) };
    const m = mergeFieldRecords(base, current, [rec(a.id, { meterId: 'x' }), rec(b.id, { observedPhase: 'C' }), rec('NOPE', {})]);
    expect(m.applied.map(x => x.id)).toEqual([a.id]);
    expect(m.conflicts.map(c => [c.id, c.reason])).toEqual([[b.id, 'changed'], ['NOPE', 'removed']]);
    expect(m.conflicts[0].server.phase).toBe(current.loads.find(l => l.id === b.id).phase);
    const f = mergeFieldRecords(base, current, [rec(b.id, { observedPhase: 'C', force: true })]);
    expect(f.design.loads.find(l => l.id === b.id).phase).toBe('C');
  });
});

describe('field outbox (client)', () => {
  it('keeps one record per connection, grouped by base version, and settles after a sync', () => {
    let s = withDesignCopy(emptyFieldState(), 7, 'Island', 3, { name: 'Island' }, 't');
    s = withRecord(s, { designId: 7, baseVersion: 3, ...rec('L1', { meterId: 'M1' }) });
    s = withRecord(s, { designId: 7, baseVersion: 3, ...rec('L1', { observedPhase: 'B' }) });
    s = withRecord(s, { designId: 7, baseVersion: 2, ...rec('L2', { note: 'n' }) });
    s = withRecord(s, { designId: 9, baseVersion: 1, ...rec('L5') });
    expect(s.outbox.filter(r => r.designId === 7)).toHaveLength(2);
    const g = syncGroups(s, 7);
    expect(g.map(x => x.baseVersion)).toEqual([2, 3]);
    expect(g[1].records[0]).toMatchObject({ id: 'L1', meterId: 'M1', observedPhase: 'B' });
    s = afterSync(s, 7, { applied: [{ kind: 'load', id: 'L1' }], conflicts: [{ kind: 'load', id: 'L2', reason: 'changed', server: { phase: 'C' } }] });
    expect(s.outbox.filter(r => r.designId === 7).map(r => [r.id, !!r.conflict])).toEqual([['L2', true]]);
    expect(syncGroups(s, 7)).toEqual([]); // conflicts wait for a decision
    s = withForced(s, 7, 'load', 'L2');
    expect(syncGroups(s, 7)[0].records[0].force).toBe(true);
    s = withoutRecord(s, 7, 'load', 'L2');
    expect(s.outbox.filter(r => r.designId === 7)).toEqual([]);
    expect(Object.keys(withoutDesignCopy(s, 7).designs)).toEqual([]);
    expect(withoutDesignCopy(s, 9, true).outbox).toEqual([]);
  });
  it('round-trips through storage and survives a broken or full one', () => {
    const mem = new Map();
    const storage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
    const s = withRecord(emptyFieldState(), { designId: 1, baseVersion: 1, ...rec('L1') });
    expect(saveFieldState(42, s, storage)).toBe(null);
    expect(loadFieldState(42, storage)).toEqual(s);
    expect(loadFieldState(43, storage)).toEqual(emptyFieldState());
    mem.set('fi.field.44', '{not json');
    expect(loadFieldState(44, storage)).toEqual(emptyFieldState());
    expect(saveFieldState(42, s, { setItem: () => { throw new Error('QuotaExceeded'); } })).toMatch(/could not store/);
  });
});
