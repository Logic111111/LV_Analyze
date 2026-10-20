import { describe, it, expect } from 'vitest';
import {
  reconductorAdvisor, applyReconductor, conductorIssues, usableConductorCodes, conductorCostPerM,
  runSnapshot, scanAndSummarize, IEC60228_AL_R20_OHM_PER_KM
} from '../loadflow.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';
import { expectGolden, poleResult } from './helpers.js';

// P2.5 — reconductoring advisor and conductor library helpers.

// FICTITIOUS test conductor: R from the IEC 60228 95 mm² Al value, everything else invented for
// the test. The app ships no data for any size beyond the two built-ins.
const TEST95 = { label: 'TEST 95 (fictitious)', R: IEC60228_AL_R20_OHM_PER_KM[95], X: 0.09, neutralScale: 1.4, I: 240, notes: 'test only' };

describe('golden: reconductor advisor on the unbalanced Walkthrough Island', () => {
  const d = walkthroughIsland();
  const r = reconductorAdvisor(d);

  it('baseline: 3 violations, 19.156 kWh, P3 violating', () => {
    expect(r.baseline.violationsByYear).toEqual({ 0: 3 });
    expectGolden(r.baseline.kwhYear0, 19.156, 3, 'baseline kWh');
    expect(r.baseline.violatingPoles).toEqual(['P3']);
  });

  it('candidate "P3 span → 70ABC": 2 violations, 18.10 kWh, P3-A 214.84 V at 20:00', () => {
    const c = r.candidates.find(x => x.changes.length === 1 && x.changes[0].pole === 'P3' && x.changes[0].to === '70ABC');
    expect(c.violationsByYear).toEqual({ 0: 2 });
    expectGolden(c.kwhYear0, 18.10, 2, 'kWh');
    expectGolden(poleResult(runSnapshot(applyReconductor(d, c.changes), { year: 0, hour: 20, solarMult: 0 }), 'P3').volt.A, 214.84, 2, 'P3 V-A');
    expect(c.violationsRemoved).toBe(1);
    expect(c.kwhSavedPerDay).toBeCloseTo(r.baseline.kwhYear0 - c.kwhYear0, 12);
  });

  it('with only the two built-ins that is the only candidate, and its cost is unknown', () => {
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0].capex).toBeNull();
    expect(r.candidates[0].lkrPerViolationRemoved).toBeNull();
    expect(r.truncated).toBe(false);
  });
});

describe('candidates from a user-added conductor', () => {
  const withLib = (costs) => {
    const d = walkthroughIsland();
    d.conductorLibrary = {
      ...d.conductorLibrary,
      '70ABC': { ...d.conductorLibrary['70ABC'], costPerM: costs.c70 },
      TEST95: { ...TEST95, costPerM: costs.c95 }
    };
    return d;
  };

  it('generates single-span and trunk candidates, deduplicated', () => {
    const r = reconductorAdvisor(withLib({}));
    const keys = r.candidates.map(c => c.changes.map(x => x.pole + ':' + x.to).join(','));
    expect(new Set(keys).size).toBe(keys.length);
    // single spans: P1→95, P2→95, P3→70, P3→95; trunk to 95 for k = 2, 3 (k = 1 duplicates P1→95)
    expect(keys.sort()).toEqual(['P1:TEST95', 'P1:TEST95,P2:TEST95', 'P1:TEST95,P2:TEST95,P3:TEST95', 'P2:TEST95', 'P3:70ABC', 'P3:TEST95'].sort());
    expect(r.candidates.find(c => c.changes.length === 3).kind).toBe('trunk');
  });

  it('every reported candidate matches an independent scan of the changed design', () => {
    const d = withLib({});
    reconductorAdvisor(d).candidates.forEach(c => {
      const s = scanAndSummarize(applyReconductor(d, c.changes));
      expect(c.voltageByYear[0]).toBe(s.voltageViolationCount);
      expect(c.kwhYear0).toBeCloseTo(s.lossKwh, 9);
    });
  });

  it('with every cost known, ties on violations go to the cheaper option; LKR per violation removed is reported', () => {
    const d = withLib({ c70: 900, c95: 1400 }); // LKR/m — test numbers
    const r = reconductorAdvisor(d);
    r.candidates.forEach(c => expect(c.capex).toBe(c.changes.reduce((s, x) => s + x.spanM * (x.to === 'TEST95' ? 1400 : 900), 0)));
    for (let i = 1; i < r.candidates.length; i++) {
      const a = r.candidates[i - 1], b = r.candidates[i];
      expect(a.totalViolations <= b.totalViolations).toBe(true);
      if (a.totalViolations === b.totalViolations) expect(a.capex <= b.capex).toBe(true);
    }
    const removing = r.candidates.find(c => c.violationsRemoved > 0);
    expect(removing.lkrPerViolationRemoved).toBeCloseTo(removing.capex / removing.violationsRemoved, 9);
  });

  it('when a cost is missing, a tier is ranked by loss instead', () => {
    const r = reconductorAdvisor(withLib({ c70: 900 })); // TEST95 has no cost
    for (let i = 1; i < r.candidates.length; i++) {
      const a = r.candidates[i - 1], b = r.candidates[i];
      if (a.totalViolations === b.totalViolations) expect(a.kwhYear0 <= b.kwhYear0).toBe(true);
    }
    expect(r.candidates.some(c => c.capex === null)).toBe(true);
  });

  it('maxCandidates caps the scan and says so', () => {
    const r = reconductorAdvisor(withLib({}), { maxCandidates: 2 });
    expect(r.candidates).toHaveLength(2);
    expect(r.truncated).toBe(true);
    expect(r.candidateCount).toBe(6);
  });
});

describe('conductor library helpers', () => {
  it('flags incomplete entries, which are never offered as candidates', () => {
    expect(conductorIssues({ R: 0.32, X: 0.09, neutralScale: 1.4, I: 240 })).toEqual([]);
    expect(conductorIssues({ R: 0.32 })).toEqual(['phase X (or |Z|)', 'neutral R (or neutral scale)', 'current rating']);
    const d = walkthroughIsland();
    d.conductorLibrary = { ...d.conductorLibrary, HALF: { R: 0.2 } };
    expect(usableConductorCodes(d)).toEqual(['70ABC', '50ABC']);
  });

  it('built-ins stay usable and have no cost until one is entered', () => {
    expect(conductorIssues(walkthroughIsland().conductorLibrary['50ABC'])).toEqual([]);
    expect(conductorCostPerM(walkthroughIsland(), '70ABC')).toBeNull();
  });

  it('IEC 60228 hint values include the built-in sizes exactly', () => {
    expect(IEC60228_AL_R20_OHM_PER_KM[70]).toBe(0.443);
    expect(IEC60228_AL_R20_OHM_PER_KM[50]).toBe(0.641);
  });
});
