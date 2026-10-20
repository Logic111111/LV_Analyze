import { describe, it, expect } from 'vitest';
import { collectIssues, issueCounts, voltageIssueHours, runDailyScan, protectionCheck, LONG_SPAN_M } from '../loadflow.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';
import { balancedIsland } from './fixtures/referenceCases.js';

// P5.5 — issues panel.

const issuesOf = (d) => { const daily = runDailyScan(d, 0); return collectIssues(d, daily, protectionCheck(d, daily)); };

describe('collectIssues', () => {
  it('fixture: the 3 undervoltage pole-phase-hours become located issues with a fix-it link', () => {
    const issues = issuesOf(walkthroughIsland());
    const v = issues.filter(i => i.category === 'voltage');
    expect(voltageIssueHours(issues)).toBe(3);
    v.forEach(i => {
      expect(i.severity).toBe('error');
      expect(i.title).toMatch(/^Undervoltage at P\d phase [ABC]$/);
      expect(i.fix).toEqual({ label: 'Open the fix-it ladder', route: 'fix-it', params: { tx: 'TX' } });
    });
    expect(v.some(i => i.location.pole === 'P3' && i.location.phase === 'A')).toBe(true);
  });

  it('flags missing data and assumptions: no fuses (warning), HV fault level not set (info)', () => {
    const issues = issuesOf(walkthroughIsland());
    expect(issues.find(i => i.id === 'fuselib').severity).toBe('warning');
    expect(issues.find(i => i.id === 'hvfault').severity).toBe('info');
    expect(issues.some(i => i.category === 'protection' && i.severity === 'warning')).toBe(true);
  });

  it('is sorted errors first', () => {
    const order = { error: 0, warning: 1, info: 2 };
    const issues = issuesOf(walkthroughIsland());
    for (let i = 1; i < issues.length; i++) expect(order[issues[i].severity]).toBeGreaterThanOrEqual(order[issues[i - 1].severity]);
    const c = issueCounts(issues);
    expect(c.error + c.warning + c.info).toBe(issues.length);
  });

  it('the balanced island has no voltage issues', () => {
    expect(issuesOf(balancedIsland()).filter(i => i.category === 'voltage')).toEqual([]);
  });

  it('flags long spans, orphan poles and incomplete conductors', () => {
    const d = walkthroughIsland();
    d.poles = [...d.poles.map(p => (p.id === 'P2' ? { ...p, spanM: LONG_SPAN_M + 5 } : p))];
    d.conductorLibrary = { ...d.conductorLibrary, BAD: { R: 0.5 } };
    d.poles = d.poles.map(p => (p.id === 'P3' ? { ...p, cond: 'BAD' } : p));
    const daily = runDailyScan({ ...d, poles: d.poles.map(p => (p.cond === 'BAD' ? { ...p, cond: '50ABC' } : p)) }, 0);
    const issues = collectIssues({ ...d, poles: [...d.poles, { id: 'X9', parent: 'NOPE', feeder: 'F1', spanM: 10, cond: '50ABC' }] }, daily);
    expect(issues.find(i => i.id === 'long|P2').severity).toBe('warning');
    expect(issues.find(i => i.id === 'cond|BAD').detail).toMatch(/phase X.*neutral R.*current rating/);
    expect(issues.find(i => i.id === 'orphan|X9').severity).toBe('error');
  });

  it('VUF above the limit is a warning while unbalance is not counted as a violation', () => {
    const d = walkthroughIsland();
    const daily = runDailyScan(d, 0).map(r => ({ ...r, vufLimitPct: 1.5 })); // test-only: tighter limit
    const issues = collectIssues({ ...d, standards: { ...d.standards, vufLimitPct: 1.5 } }, daily);
    const w = issues.filter(i => i.id.startsWith('vuf|'));
    expect(w.length).toBeGreaterThan(0);
    w.forEach(i => { expect(i.severity).toBe('warning'); expect(i.fix.route).toBe('load-balance'); });
  });
});

describe('worker task', () => {
  it('issues equals collectIssues on a fresh scan, and clones cleanly', async () => {
    const { ENGINE_TASKS } = await import('../engineTasks.js');
    const d = walkthroughIsland();
    const viaTask = ENGINE_TASKS.issues({ design: d }, {});
    expect(viaTask).toEqual(issuesOf(d));
    expect(structuredClone(viaTask)).toEqual(viaTask);
  });
});
