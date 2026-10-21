import { describe, it, expect } from 'vitest';
import { withDefaults, proposePhaseBalance, applyPhaseBalance, computeSystemHostingCapacity, evaluateDesign, runSnapshot, HOSTING_TEST_HOURS, collectIssues, runDailyScan } from '../loadflow.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';
import { expectGolden } from './helpers.js';

// O3.5 — the transformer limit in both directions (off by default) and the reverse-flow warning.
const balanced = () => { const d = withDefaults(walkthroughIsland()); return applyPhaseBalance(d, proposePhaseBalance(d, 'TX').changed); };

describe('transformer reverse-flow limit (O3.5)', () => {
  it('the legacy system PV allocation loads the 100 kVA transformer to 107.7 % in reverse flow at 13:00', () => {
    const d = balanced();
    const sys = computeSystemHostingCapacity(d);
    expectGolden(sys.totalKva, 111.65, 2, 'legacy queue (post-P1.3 value; the O-prompt quotes 111.75)');
    const extraPV = sys.results.filter(r => r.achievableKva > 0.05).map(r => ({ pole: r.pole, phase: r.phase, kva: r.achievableKva }));
    const e = evaluateDesign(d, { hours: HOSTING_TEST_HOURS, extraPV });
    expect(e.reverseFlowMax.hour).toBe(13);
    // The O-prompt's 107.8 % was measured on its 111.75 kVA allocation (before the P1.3 fixes);
    // this code's 111.65 kVA allocation gives 107.72 % (see PROGRESS.md, Golden-value notes).
    expectGolden(e.reverseFlowMax.pct, 107.72, 2, 'reverse-flow loading at 13:00');
    // Import-only (default): not a violation, but listed for the warning.
    const r13 = runSnapshot(d, { year: 0, hour: 13, loadMult: 1, solarMult: 1, extraPV });
    expect(r13.violations.some(v => v.type === 'transformer overload')).toBe(false);
    expect(r13.reverseFlowOverloads).toEqual([expect.objectContaining({ txId: 'TX', counted: false })]);
    // Both directions: the same allocation now has transformer violations.
    const both = evaluateDesign(d, { hours: HOSTING_TEST_HOURS, extraPV, txLimitBothDirections: true });
    expect(both.violations.transformer).toBeGreaterThan(0);
  });
  it('off by default: no design changes behaviour; the issues list warns and recommends the option', () => {
    const d = balanced();
    expect(runSnapshot(d, { year: 0, hour: 13, loadMult: 1, solarMult: 1 }).reverseFlowOverloads).toEqual([]);
    const extraPV = [{ pole: 'P1', phase: 'A', kva: 60 }, { pole: 'P1', phase: 'B', kva: 60 }, { pole: 'P1', phase: 'C', kva: 60 }];
    const withPv = { ...d, pv: [...d.pv, ...extraPV.map((x, i) => ({ id: 'X' + i, ...x }))] };
    const issues = collectIssues(withPv, runDailyScan(withPv, 0));
    const w = issues.find(i => i.id === 'reverse|TX');
    expect(w && w.severity).toBe('warning');
    expect(w.detail).toMatch(/reverse flow too/);
  });
});
