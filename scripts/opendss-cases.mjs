// Writes the OpenDSS cross-validation cases (P7.6): for each case, <name>.dss (the export) and
// <name>.app.json (the app's own voltages for the same snapshot). Used by validate-opendss.py;
// dev-only, nothing here ships. Usage: node scripts/opendss-cases.mjs <outDir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDSSCheckCase } from '../packages/engine/index.js';
import { walkthroughIsland } from '../client/src/lib/__tests__/fixtures/walkthroughIsland.js';
import { syntheticFeeder } from '../client/src/lib/__tests__/fixtures/syntheticFeeder.js';
import { twoFeeders } from '../client/src/lib/__tests__/fixtures/twoFeeders.js';

const outDir = process.argv[2] || 'opendss-out';
mkdirSync(outDir, { recursive: true });

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

// A second transformer feeding P3 over a 0 m span, earth electrodes on both subtrees (the
// reference lock's twoTx variant).
function twoTxVariant() {
  const d = walkthroughIsland();
  d.transformers = [...d.transformers, { id: 'TX2', name: 'TX2', txRating: 160, tap: 1, hvActual: 11000, txXR: 4, txGroundOhms: 5 }];
  d.poles = d.poles.map(p => p.id === 'P3' ? { ...p, parent: 'TX2', spanM: 0, grounded: true, groundOhms: 15 }
    : p.id === 'P2' ? { ...p, grounded: true, groundOhms: 25 } : p);
  return d;
}

const cases = [
  { name: 'walkthrough-2000', label: 'Walkthrough Island, 20:00 evening peak', design: walkthroughIsland(), opts: { year: 0, hour: 20, loadMult: 1, solarMult: 1 } },
  { name: 'walkthrough-1200', label: 'Walkthrough Island, 12:00 solar noon', design: walkthroughIsland(), opts: { year: 0, hour: 12, loadMult: 1, solarMult: 1 } },
  { name: 'synthetic50-2000', label: '50-pole feeder, 20:00 evening peak', design: syntheticFeeder(), opts: { year: 0, hour: 20, loadMult: 1, solarMult: 1 } },
  { name: 'synthetic50-1200', label: '50-pole feeder, 12:00 with PV and BESS', design: syntheticFeeder(), opts: { year: 0, hour: 12, loadMult: 1, solarMult: 1 } },
  { name: 'synthetic50-heavy-2000', label: '50-pole feeder, 20:00, load x1.5', design: syntheticFeeder(), opts: { year: 0, hour: 20, loadMult: 1.5, solarMult: 1 } },
  { name: 'synthetic50-grounded-2000', label: '50-pole feeder, 8 earthed poles', design: syntheticFeeder({ grounded: true }), opts: { year: 0, hour: 20, loadMult: 1, solarMult: 1 } },
  { name: 'synthetic50-zip-2000', label: '50-pole feeder, ZIP (voltage-dependent) loads', design: { ...syntheticFeeder(), loadModel: 'zip', zipZ: 0.3, zipI: 0.3, zipP: 0.4 }, opts: { year: 0, hour: 20, loadMult: 1, solarMult: 1 } },
  { name: 'walkthrough-coupled-2000', label: 'Walkthrough Island, coupled 4x4 line model', design: coupledVariant(walkthroughIsland()), opts: { year: 0, hour: 20, loadMult: 1, solarMult: 1 } },
  { name: 'walkthrough-twotx-2000', label: 'Two transformers, 0 m span, earthed poles', design: twoTxVariant(), opts: { year: 0, hour: 20, loadMult: 1, solarMult: 1 } },
  { name: 'twofeeders-2000', label: 'Two 12-pole feeders, heavily loaded (undervoltage)', design: twoFeeders(), opts: { year: 0, hour: 20, loadMult: 1, solarMult: 1 } }
];

const index = [];
for (const c of cases) {
  const { script, app } = openDSSCheckCase(c.design, c.opts);
  writeFileSync(join(outDir, `${c.name}.dss`), script);
  writeFileSync(join(outDir, `${c.name}.app.json`), JSON.stringify({ name: c.name, label: c.label, ...app }, null, 1));
  index.push(c.name);
}
writeFileSync(join(outDir, 'cases.json'), JSON.stringify(index));
console.log(`${index.length} cases written to ${outDir}`);
