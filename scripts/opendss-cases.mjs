// Writes the OpenDSS cross-validation cases (P7.6): for each case, <name>.dss (the export) and
// <name>.app.json (the app's own voltages for the same snapshot). Used by validate-opendss.py;
// dev-only, nothing here ships. Usage: node scripts/opendss-cases.mjs <outDir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { toOpenDSS, runSnapshotAt } from '../packages/engine/index.js';
import { walkthroughIsland } from '../client/src/lib/__tests__/fixtures/walkthroughIsland.js';
import { syntheticFeeder } from '../client/src/lib/__tests__/fixtures/syntheticFeeder.js';

const outDir = process.argv[2] || 'opendss-out';
mkdirSync(outDir, { recursive: true });

const abs = (z) => Math.hypot(z.re, z.im);
// A coupled-model variant: every conductor gets a 4×4 matrix with its own R/X on the diagonal and
// made-up mutual terms. A test matrix only — it exercises the coupled path, it isn't cable data.
function coupledVariant(d) {
  const out = { ...d, lineModel: 'coupled', conductorLibrary: { ...(d.conductorLibrary || {}) } };
  const codes = [...new Set(d.poles.map(p => p.cond))];
  codes.forEach(code => {
    const R = 0.3, X = 0.08, Rn = 0.45, Xn = 0.09, Rm = 0.05, Xm = 0.03;
    const zMatrix = [0, 1, 2, 3].map(i => [0, 1, 2, 3].map(j => (i === j ? (i === 3 ? [Rn, Xn] : [R, X]) : [Rm, Xm])));
    out.conductorLibrary[code] = { name: `${code} (test matrix)`, R, Z: Math.hypot(R, X), X, Rn, Xn, I: 300, neutralScale: Rn / R, zMatrix };
  });
  return out;
}

const cases = [
  { name: 'walkthrough-2000', design: walkthroughIsland(), opts: { year: 0, hour: 20, loadMult: 1, solarMult: 1 } },
  { name: 'walkthrough-1200', design: walkthroughIsland(), opts: { year: 0, hour: 12, loadMult: 1, solarMult: 1 } },
  { name: 'synthetic50-2000', design: syntheticFeeder(), opts: { year: 0, hour: 20, loadMult: 1, solarMult: 1 } },
  { name: 'synthetic50-1200', design: syntheticFeeder(), opts: { year: 0, hour: 12, loadMult: 1, solarMult: 1 } },
  { name: 'synthetic50-grounded-2000', design: syntheticFeeder({ grounded: true }), opts: { year: 0, hour: 20, loadMult: 1, solarMult: 1 } },
  { name: 'synthetic50-zip-2000', design: { ...syntheticFeeder(), loadModel: 'zip', zipZ: 0.3, zipI: 0.3, zipP: 0.4 }, opts: { year: 0, hour: 20, loadMult: 1, solarMult: 1 } },
  { name: 'walkthrough-coupled-2000', design: coupledVariant(walkthroughIsland()), opts: { year: 0, hour: 20, loadMult: 1, solarMult: 1 } }
];

const index = [];
for (const c of cases) {
  const res = runSnapshotAt(c.design, c.opts);
  const { script, buses, notes } = toOpenDSS(c.design, { ...c.opts, result: res });
  writeFileSync(join(outDir, `${c.name}.dss`), script);
  const app = {
    name: c.name, status: res.status,
    poles: res.poleResults.map(p => ({ id: p.id, bus: buses.poles[p.id], V: { A: p.volt.A, B: p.volt.B, C: p.volt.C } })),
    transformers: res.transformers.map(t => ({ id: t.id, bus: buses.transformers[t.id], V: { A: abs(t.busVph.A), B: abs(t.busVph.B), C: abs(t.busVph.C) } })),
    notes
  };
  writeFileSync(join(outDir, `${c.name}.app.json`), JSON.stringify(app, null, 1));
  index.push(c.name);
}
writeFileSync(join(outDir, 'cases.json'), JSON.stringify(index));
console.log(`${index.length} cases written to ${outDir}`);
