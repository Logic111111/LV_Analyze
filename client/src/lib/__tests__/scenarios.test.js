import { describe, it, expect } from 'vitest';
import {
  designPatch, applyPatch, applyScenario, scenarioMetrics, compareScenarios, describePatch, patchCapex,
  CURRENT_DESIGN_SCENARIO, proposePhaseBalance, applyPhaseBalance, applyReconductor, computeFeederSplitCandidates,
  buildSplitCandidate, runDailyScan, systemLossW, withDefaults
} from '../loadflow.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';

// P5.4 — scenarios.

const pick = (d) => ({ transformers: d.transformers, poles: d.poles, loads: d.loads, pv: d.pv, bess: d.bess, openPoints: d.openPoints });

describe('patches', () => {
  const base = walkthroughIsland();
  const variants = {
    balance: applyPhaseBalance(base, proposePhaseBalance(base, 'TX').changed),
    reconductor: applyReconductor(base, [{ pole: 'P3', to: '70ABC' }]),
    split: (() => {
      const r = computeFeederSplitCandidates(base, 'P1', { txRating: 100, tap: 2, hvActual: 10800, txXR: 3, txGroundOhms: 7.5 }, { mode: 'atSplit', cond: '70ABC' }, [20], 0);
      return buildSplitCandidate(base, r.newTx, r.candidates[0].reparentPlan);
    })()
  };

  it.each(Object.keys(variants))('%s: applying the patch to the base gives the variant back', (k) => {
    const patch = designPatch(base, variants[k]);
    expect(pick(applyPatch(base, patch))).toEqual(pick(variants[k]));
  });

  it('a patch holds only what changed', () => {
    const patch = designPatch(base, variants.balance);
    expect(Object.keys(patch).every(k => ['loads', 'pv', 'bess'].includes(k))).toBe(true);
    const moved = proposePhaseBalance(base, 'TX').changed.length;
    expect((patch.loads?.upsert.length || 0) + (patch.pv?.upsert.length || 0)).toBe(moved);
    expect(describePatch(designPatch(base, variants.reconductor))).toBe('1 pole/span changed/added');
    expect(designPatch(base, base)).toEqual({});
  });

  it('capex: only reconductoring with user costs has a number; the rest is listed as missing', () => {
    expect(patchCapex(base, variants.reconductor).lkr).toBeNull(); // no costPerM in the built-ins
    const priced = { ...variants.reconductor, conductorLibrary: { ...variants.reconductor.conductorLibrary, '70ABC': { ...variants.reconductor.conductorLibrary['70ABC'], costPerM: 1000 } } };
    expect(patchCapex(base, priced).lkr).toBe(1000 * 60);
    expect(patchCapex(base, variants.balance).missing[0]).toMatch(/Connection moved/);
  });
});

describe('scenarios', () => {
  const base = walkthroughIsland();

  it('the current-design scenario reproduces the plain 24 h scan', () => {
    const m = scenarioMetrics(base, CURRENT_DESIGN_SCENARIO);
    const daily = runDailyScan(base, 0);
    expect(m.lossKwhDay).toBeCloseTo(daily.reduce((s, r) => s + systemLossW(r).totalLossW / 1000, 0), 9);
    expect(m.voltageViolations).toBe(daily.reduce((n, r) => n + r.violations.filter(v => v.type.endsWith('voltage')).length, 0));
    expect(m.lossLkrYear).toBeNull(); // no energy cost entered
  });

  it('applies tap, standards profile, year and multipliers', () => {
    const sc = { id: 's1', name: 'EN 50160, tap 3, year 2', year: 2, loadMult: 1.1, solarMult: 0.5, taps: { TX: 3 }, standardsProfileId: 'en50160', patch: null };
    const a = applyScenario(base, sc);
    expect(a.design.transformers[0].tap).toBe(3);
    expect(a.design.vdev).toBe(10);
    expect([a.year, a.loadMult, a.solarMult]).toEqual([2, 1.1, 0.5]);
    expect(base.transformers[0].tap).toBe(2); // never mutated
  });

  it('compares side by side and marks the best value in each row', () => {
    const balanced = applyPhaseBalance(base, proposePhaseBalance(base, 'TX').changed);
    const scs = [CURRENT_DESIGN_SCENARIO, { id: 'bal', name: 'Rebalanced', year: 0, loadMult: 1, solarMult: 1, taps: {}, patch: designPatch(base, balanced) }];
    const r = compareScenarios(base, scs);
    expect(r.columns.map(c => c.id)).toEqual(['__current', 'bal']);
    expect(r.columns[0].voltageViolations).toBe(3);
    expect(r.columns[1].voltageViolations).toBe(0);
    expect(r.best.voltageViolations).toEqual(['bal']);
    expect(r.best.lossKwhDay).toEqual(['bal']);
    expect(r.best.lossLkrYear).toEqual([]); // no numbers to compare
  });

  it('old designs get an empty scenario list', () => {
    const old = { ...walkthroughIsland() }; delete old.scenarios;
    expect(withDefaults(old).scenarios).toEqual([]);
  });
});
