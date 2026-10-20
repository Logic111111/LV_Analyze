import { describe, it, expect } from 'vitest';
import { npv, optionEconomics, capexOf, economicsOf, withDefaults, applyReconductor, proposePhaseBalance, applyPhaseBalance } from '../loadflow.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';

// P6.1 — economics.

describe('NPV and payback', () => {
  it('hand-checked case: 100 000 LKR capex, 20 000 LKR/yr for 10 years at 10 %', () => {
    // Annuity factor (1 − 1.1^−10) / 0.1 = 6.144567106; PV = 122 891.34; NPV = 22 891.34.
    expect(npv(100000, 20000, 10, 10)).toBeCloseTo(22891.342, 2);
    expect(npv(100000, 20000, 0, 10)).toBeCloseTo(100000, 9);
  });

  it('optionEconomics: annual figures, payback and NPV — or null when an input is missing', () => {
    const d = { ...walkthroughIsland(), economics: { lossCostLkrPerKwh: 50, discountRatePct: 10, studyYears: 10 } };
    const r = optionEconomics(d, { baseKwhDay: 19.156, optionKwhDay: 13.288, capexLkr: 50000 });
    expect(r.kwhYearSaved).toBeCloseTo((19.156 - 13.288) * 365, 9);
    expect(r.lkrYearSaved).toBeCloseTo(r.kwhYearSaved * 50, 9);
    expect(r.paybackYears).toBeCloseTo(50000 / r.lkrYearSaved, 9);
    expect(r.npvLkr).toBeCloseTo(npv(50000, r.lkrYearSaved, 10, 10), 9);
    const none = optionEconomics(walkthroughIsland(), { baseKwhDay: 19, optionKwhDay: 13, capexLkr: null });
    expect([none.lkrYearSaved, none.paybackYears, none.npvLkr]).toEqual([null, null, null]);
  });
});

describe('capex', () => {
  const base = walkthroughIsland();
  it('prices re-strung spans from the library and moves from the rewire cost; lists what is missing', () => {
    const recon = applyReconductor(base, [{ pole: 'P3', to: '70ABC' }]);
    expect(capexOf(base, recon).missing).toEqual(['Restring span into P3 with 70ABC']);
    const priced = { ...recon, conductorLibrary: { ...recon.conductorLibrary, '70ABC': { ...recon.conductorLibrary['70ABC'], costPerM: 1200 } } };
    expect(capexOf(base, priced).lkr).toBe(1200 * 60);
    const bal = applyPhaseBalance(base, proposePhaseBalance(base, 'TX').changed);
    expect(capexOf(base, bal).lkr).toBeNull();
    expect(capexOf(base, { ...bal, economics: { rewirePerMoveLkr: 3000 } }).lkr).toBe(9 * 3000);
  });

  it('new transformers by rating, tap changes as outages', () => {
    const v = { ...base, transformers: [{ ...base.transformers[0], tap: 3 }, { ...base.transformers[0], id: 'TX2', txRating: 160 }], economics: { tapChangeLkr: 15000, transformerCostLkr: { 160: 2500000 } } };
    expect(capexOf(base, v).lkr).toBe(15000 + 2500000);
  });

  it('old designs get blank economics (nothing assumed)', () => {
    const d = withDefaults(walkthroughIsland());
    expect(economicsOf(d)).toEqual({ lossCostLkrPerKwh: null, discountRatePct: null, studyYears: null, rewirePerMoveLkr: null, tapChangeLkr: null, transformerCostLkr: {} });
  });
});

describe('economics in scenarios and the report', () => {
  it('scenario comparison: LKR/yr saved, payback and NPV against the current design', async () => {
    const { compareScenarios, designPatch, CURRENT_DESIGN_SCENARIO } = await import('../loadflow.js');
    const base = { ...walkthroughIsland(), economics: { lossCostLkrPerKwh: 50, discountRatePct: 10, studyYears: 10, rewirePerMoveLkr: 3000 } };
    const bal = applyPhaseBalance(base, proposePhaseBalance(base, 'TX').changed);
    const r = compareScenarios(base, [CURRENT_DESIGN_SCENARIO, { id: 'bal', name: 'Balanced', year: 0, loadMult: 1, solarMult: 1, taps: {}, patch: designPatch(base, bal) }]);
    const c = r.columns.find(x => x.id === 'bal');
    expect(c.capexLkr).toBe(9 * 3000);
    expect(c.lkrYearSavedVsCurrent).toBeCloseTo((r.columns[0].lossKwhDay - c.lossKwhDay) * 365 * 50, 6);
    expect(c.npvLkr).toBeCloseTo(npv(27000, c.lkrYearSavedVsCurrent, 10, 10), 6);
    expect(r.columns[0].npvLkr).toBeNull();
  });

  it('the report shows the economics inputs and the fix-it remedies\' figures', async () => {
    const { buildReportHtml } = await import('../report.js');
    const { fixItLadder, runSnapshot } = await import('../loadflow.js');
    const d = { ...walkthroughIsland(), economics: { lossCostLkrPerKwh: 50, discountRatePct: 10, studyYears: 10, rewirePerMoveLkr: 3000 } };
    const html = buildReportHtml(d, runSnapshot(d, { year: 0, hour: 20 }), null, null, null, { fixIt: fixItLadder(d, { years: [0] }) });
    expect(html).toContain('Fix-it ladder remedies');
    expect(html).toContain('50.00 LKR/kWh');
    expect(html).not.toContain('Economics not set');
  });
});
