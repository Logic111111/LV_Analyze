import { describe, it, expect } from 'vitest';
import { withDefaults, runSnapshot, balanceExactDP } from '../loadflow.js';
import { buildReportHtml } from '../report.js';
import { optSummary } from '../optSummary.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';

// O7 — the report's Optimisation section lists each optimiser's latest result and certificate.
describe('report: Optimisation section (O7)', () => {
  const d = withDefaults(walkthroughIsland());
  const res = runSnapshot(d, { year: 0, hour: 20, loadMult: 1, solarMult: 1 });
  it('says nothing has been run yet', () => {
    const html = buildReportHtml(d, res, null, null, null, {});
    expect(html).toMatch(/Optimisation/);
    expect(html).toMatch(/No optimiser has been run/);
  });
  it('lists results with their certificates and notes', () => {
    const dp = balanceExactDP(d, 'TX', { maxMoves: 9 });
    const optimisation = {
      balanceDP: optSummary('Exact phase balance (nameplate)', 'Smallest spread 0.5 with 6 moves', dp),
      hosting: { title: 'PV hosting', headline: 'maximum total 149.50 kVA', method: 'SLP', certificate: 'lp-bound', gapPct: 0.09, evaluations: 51, ms: 63, notes: [] },
      bessLoss: { title: 'BESS sizes', headline: '12.527 kWh/day', method: 'Projected gradient', certificate: 'heuristic', restartsFoundBest: { found: 4, of: 10 }, evaluations: 1272, ms: 2400, notes: ['n1'] }
    };
    const html = buildReportHtml(d, res, null, null, null, { optimisation });
    expect(html).toMatch(/Exact optimum/);
    expect(html).toMatch(/Within 0\.1 % of bound/);
    expect(html).toMatch(/Best found \(4\/10 restarts agree\)/);
    expect(html).toMatch(/Smallest spread 0\.5 with 6 moves/);
    expect(html).toMatch(/BESS sizes: n1/);
  });
});
