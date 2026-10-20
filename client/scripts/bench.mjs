// npm run bench — engine timings on the synthetic 50-pole / 200-connection island (the size the
// performance budget is stated for: one snapshot < 50 ms). Uses only the public loadflow.js API,
// so the same script times the engine before and after any internal change. Results go to the
// console; PROGRESS.md keeps the before/after table.
import { runSnapshot, runDailyScan, scanAndSummarize, computeHostingCapacity, proposePhaseBalance } from '../src/lib/loadflow.js';
import { syntheticFeeder } from '../src/lib/__tests__/fixtures/syntheticFeeder.js';
import { walkthroughIsland } from '../src/lib/__tests__/fixtures/walkthroughIsland.js';

function time(label, fn, { repeat = 1, warmup = 1 } = {}) {
  for (let i = 0; i < warmup; i++) fn();
  const t0 = performance.now();
  let out;
  for (let i = 0; i < repeat; i++) out = fn();
  const ms = (performance.now() - t0) / repeat;
  console.log(`${label.padEnd(58)} ${ms.toFixed(ms < 10 ? 2 : 1).padStart(9)} ms${repeat > 1 ? `  (mean of ${repeat})` : ''}`);
  return out;
}

const plain = syntheticFeeder();
const grounded = syntheticFeeder({ grounded: true });
const quick = process.argv.includes('--quick');

console.log(`Node ${process.version}${quick ? ' (quick)' : ''}`);
const snap = time('snapshot, 50 poles / 200 conn, 20:00', () => runSnapshot(plain, { year: 0, hour: 20 }), { repeat: 20, warmup: 3 });
console.log(`  (converged ${snap.converged} in ${snap.iterUsed} iterations, ${snap.violations.length} violations)`);
const gsnap = time('snapshot, same feeder with 8 grounded poles, 20:00', () => runSnapshot(grounded, { year: 0, hour: 20 }), { repeat: 20, warmup: 3 });
console.log(`  (converged ${gsnap.converged} in ${gsnap.iterUsed} iterations)`);
time('runDailyScan (24 snapshots)', () => runDailyScan(plain, 0), { repeat: 3 });
time('runDailyScan, grounded (24 snapshots)', () => runDailyScan(grounded, 0), { repeat: 3 });
time('scanAndSummarize (24 h)', () => scanAndSummarize(plain), { repeat: 3 });
time('proposePhaseBalance', () => proposePhaseBalance(plain, 'TX'), { repeat: 20 });
time('Walkthrough Island snapshot (3 poles)', () => runSnapshot(walkthroughIsland(), { year: 0, hour: 20, solarMult: 0 }), { repeat: 200, warmup: 20 });
if (!quick) {
  time('computeHostingCapacity, 50 poles × 3 phases', () => computeHostingCapacity(plain), { warmup: 0 });
}
