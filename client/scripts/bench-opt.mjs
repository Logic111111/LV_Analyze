// npm run bench:opt — timings of the optimisers (Optimisation Upgrade O8) against the budgets in
// the O-prompt, on the Walkthrough Island (balanced where the goldens say so), the two-feeder
// network and the 50-pole synthetic feeder. Prints each result with its budget and the key figure,
// so a regression in speed or answer shows up together. PROGRESS.md keeps the table.
import {
  withDefaults, proposePhaseBalance, applyPhaseBalance, balanceExactDP, balanceOptimise, hostingMaxTotalSLP, hostingFairShare,
  bessLossOptimal, dualFeederOptimise, reconductorOptimise, networkJacobian, finiteDifferenceJacobian, runSnapshot
} from '../src/lib/loadflow.js';
import { walkthroughIsland } from '../src/lib/__tests__/fixtures/walkthroughIsland.js';
import { syntheticFeeder } from '../src/lib/__tests__/fixtures/syntheticFeeder.js';
import { twoFeeders } from '../src/lib/__tests__/fixtures/twoFeeders.js';

const rows = [];
function bench(label, budgetMs, fn, figure) {
  const t0 = performance.now();
  const out = fn();
  const ms = performance.now() - t0;
  const ok = budgetMs == null || ms <= budgetMs;
  rows.push({ label, ms, budgetMs, ok, figure: figure(out) });
  console.log(`${ok ? 'ok  ' : 'SLOW'} ${label.padEnd(52)} ${ms.toFixed(ms < 100 ? 1 : 0).padStart(8)} ms  ${budgetMs == null ? '' : `(budget ${budgetMs} ms)`}  ${figure(out)}`);
  return out;
}

const fixture = withDefaults(walkthroughIsland());
const balanced = applyPhaseBalance(fixture, proposePhaseBalance(fixture, 'TX').changed);
const synth = withDefaults(syntheticFeeder());
const two = withDefaults(twoFeeders());
const txSpec = { name: 'TX2', txRating: 100, tap: 2, hvActual: 10800, txXR: 3, txGroundOhms: 7.5 };
const quick = process.argv.includes('--quick');

console.log(`Node ${process.version}${quick ? ' (quick)' : ''}`);
bench('O2.1 exact DP balance, fixture (K ≤ 9)', 200, () => balanceExactDP(fixture, 'TX', { maxMoves: 9 }), r => `spreads ${r.table.map(t => t.spread).join(',')}; ${r.states} states`);
bench('O2.1 exact DP balance, 50-pole feeder (K ≤ 10)', null, () => balanceExactDP(synth, 'TX', { maxMoves: 10 }), r => `min spread ${r.table[r.table.length - 1].spread}; ${r.states} states`);
bench('O2.2 load-flow balance, exhaustive levels 1–3', 10000, () => balanceOptimise(fixture, 'TX', { maxMoves: 3 }), r => `${r.table.slice(1).map(t => `${t.distinct}/${t.feasible}/${t.bestWithin.lossKwh.toFixed(3)}`).join('  ')}`);
if (!quick) bench('O2.2 annealing only, 20 restarts × 3000 evals', null, () => balanceOptimise(fixture, 'TX', { maxMoves: 3, exact: false, restarts: 20, budget: 3000 }), r => `best ${r.table[3].bestWithin.lossKwh.toFixed(3)} kWh, ${r.restartsFoundBest.found}/${r.restartsFoundBest.of} restarts`);
const so = { year: 0, hour: 12, loadMult: 1, solarMult: 1 };
const base = runSnapshot(synth, so);
const locs = synth.poles.flatMap(p => ['A', 'B', 'C'].map(ph => ({ pole: p.id, phase: ph })));
bench('O1.3 Jacobian, semi-analytic, 50 poles × 3 phases', null, () => networkJacobian(synth, base, locs), () => `${locs.length} locations`);
if (!quick) bench('O1.3 Jacobian, finite differences (reference)', null, () => finiteDifferenceJacobian(synth, so, locs, { base }), () => `${2 * locs.length} load flows`);
bench('O3.2 SLP max hosting, balanced fixture', 30000, () => hostingMaxTotalSLP(balanced), r => `${r.totalKva.toFixed(2)} kVA (≥ 149.0), gap ${r.gapPct.toFixed(2)} %`);
bench('O3.2 SLP max hosting, limit both directions', 30000, () => hostingMaxTotalSLP(balanced, { txLimitBothDirections: true }), r => `${r.totalKva.toFixed(2)} kVA (≥ 103.80)`);
bench('O3.2 SLP max BESS, balanced fixture', 30000, () => hostingMaxTotalSLP(balanced, { kind: 'bess' }), r => `${r.totalKva.toFixed(2)} kVA (legacy queue 69.95)`);
bench('O3.3 fair share, balanced fixture', null, () => hostingFairShare(balanced), r => `${r.sizeKva.toFixed(3)} kVA × ${r.locations.length} = ${r.totalKva.toFixed(2)} kVA`);
if (!quick) bench('O3.2 SLP max hosting, 50-pole feeder', null, () => hostingMaxTotalSLP(synth), r => `${r.totalKva.toFixed(2)} kVA, gap ${r.gapPct.toFixed(2)} %, ${r.evaluations} load flows`);
bench('O4 BESS sizes for minimum loss, balanced fixture', null, () => bessLossOptimal(balanced), r => `${r.lossKwh.toFixed(3)} kWh/day (none 13.288, legacy 25.474); ${r.restartsFoundBest.found}/${r.restartsFoundBest.of}`);
bench('O5 dual-feeder split, 12 × 12 pairs (24 h)', null, () => dualFeederOptimise(two, 'OP1', txSpec, '70ABC'), r => `${r.certificate}, best ${r.candidates[0].poleA} & ${r.candidates[0].poleB}`);
bench('O6 reconductor optimisation, fixture', null, () => reconductorOptimise(fixture, { years: [0, 5] }), r => `${r.method}, ${r.certificate}`);

const slow = rows.filter(r => !r.ok);
console.log(slow.length ? `\n${slow.length} over budget.` : '\nAll within budget.');
process.exitCode = slow.length ? 1 : 0;
