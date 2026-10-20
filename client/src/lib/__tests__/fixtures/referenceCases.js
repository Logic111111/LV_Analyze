import { runSnapshot, scanAndSummarize, dailyEnergyLossKwh, proposePhaseBalance, applyPhaseBalance } from '../../loadflow.js';
import { walkthroughIsland } from './walkthroughIsland.js';
import { syntheticFeeder } from './syntheticFeeder.js';

// Shared by the full-precision regression lock (reference.test.js) and its generator
// (scripts/gen-reference.mjs), so the test always recomputes exactly the cases the reference file
// was captured from. The variants deliberately reach code paths the brief's golden table doesn't:
// the grounded-pole nodal neutral solve, ZIP loads, BESS charge/discharge/idle, 3-phase (ABC)
// connections, shop/EVCS curves, excluded connection types, a 0 m span, and a two-transformer
// forest. Adding a case is fine (regenerate); changing an existing one is not.

export function balancedIsland() {
  const d = walkthroughIsland();
  return applyPhaseBalance(d, proposePhaseBalance(d, 'TX').changed);
}

const VARIANTS = {
  unbalanced: () => walkthroughIsland(),
  balanced: () => balancedIsland(),
  // Two earth electrodes: the neutral becomes a nodal network (solveComplexLinearSystem path).
  grounded: () => {
    const d = walkthroughIsland();
    d.poles = d.poles.map(p => p.id === 'P1' ? { ...p, grounded: true, groundOhms: 10 }
      : p.id === 'P3' ? { ...p, grounded: true, groundOhms: 20 } : p);
    return d;
  },
  // Voltage-dependent demand with the default 0.2 / 0.2 / 0.6 coefficients.
  zip: () => ({ ...walkthroughIsland(), loadModel: 'zip' }),
  // One single-phase and one 3-phase BESS on the balanced island (charge 10–14, discharge 19–23).
  bess: () => ({
    ...balancedIsland(),
    bess: [{ id: 'B1', pole: 'P3', phase: 'B', kva: 5 }, { id: 'B2', pole: 'P2', phase: 'ABC', kva: 6 }]
  }),
  // Shop and EVCS curves, 3-phase loads and 3-phase PV.
  mixedTypes: () => {
    const d = walkthroughIsland();
    d.loads.push({ id: 'L19', pole: 'P2', type: 'shop', phase: 'ABC', kva: 10 });
    d.loads.push({ id: 'L20', pole: 'P1', type: 'evcs', phase: 'B', kva: 7 });
    d.loads.push({ id: 'L21', pole: 'P3', type: 'general', phase: 'ABC', kva: 4.5 });
    d.pv.push({ id: 'S3', pole: 'P1', phase: 'ABC', kva: 6 });
    return d;
  },
  excludedTypes: () => ({ ...walkthroughIsland(), includeEV: false, includeSolar: false }),
  // A second transformer feeding P3 over a 0 m span (a split "at the split point"), with an earth
  // electrode on each subtree.
  twoTx: () => {
    const d = walkthroughIsland();
    d.transformers = [...d.transformers, { id: 'TX2', name: 'TX2', txRating: 160, tap: 1, hvActual: 11000, txXR: 4, txGroundOhms: 5 }];
    d.poles = d.poles.map(p => p.id === 'P3' ? { ...p, parent: 'TX2', spanM: 0, grounded: true, groundOhms: 15 }
      : p.id === 'P2' ? { ...p, grounded: true, groundOhms: 25 } : p);
    return d;
  },
  // The 50-pole / 200-connection synthetic island (benchmark size), plain and with 8 earth
  // electrodes — a realistically sized tree, branchy feeders, every connection type, and a 51-node
  // neutral matrix. Added before any Phase 1 engine change, from the untouched engine.
  synthetic: () => syntheticFeeder(),
  syntheticGrounded: () => syntheticFeeder({ grounded: true })
};

const snap = (variant, opts) => ({ kind: 'snapshot', variant, opts });

export const REFERENCE_CASES = [
  snap('unbalanced', { year: 0, hour: 20, solarMult: 0 }),
  snap('unbalanced', { year: 5, hour: 20, solarMult: 0 }),
  snap('unbalanced', { year: 0, hour: 12, solarMult: 1 }),
  snap('unbalanced', { year: 0, hour: 12, solarMult: 1.5 }),
  snap('unbalanced', { year: 0, hour: 3 }),
  snap('unbalanced', { year: 2, hour: 9, loadMult: 0.5 }),
  snap('unbalanced', { year: 0, hour: 12, extraPV: [{ pole: 'P3', phase: 'B', kva: 3 }] }),
  snap('unbalanced', { year: 0, hour: 20, extraBess: [{ pole: 'P3', phase: 'A', kva: 4 }] }),
  snap('balanced', { year: 0, hour: 20, solarMult: 0 }),
  snap('balanced', { year: 5, hour: 20, solarMult: 0 }),
  snap('balanced', { year: 0, hour: 12, solarMult: 1 }),
  snap('grounded', { year: 0, hour: 20, solarMult: 0 }),
  snap('grounded', { year: 0, hour: 12, solarMult: 1.5 }),
  snap('zip', { year: 0, hour: 20, solarMult: 0 }),
  snap('zip', { year: 5, hour: 20, solarMult: 0 }),
  snap('bess', { year: 0, hour: 12 }),
  snap('bess', { year: 0, hour: 20 }),
  snap('bess', { year: 0, hour: 3 }),
  snap('mixedTypes', { year: 0, hour: 12 }),
  snap('mixedTypes', { year: 1, hour: 20 }),
  snap('excludedTypes', { year: 0, hour: 20 }),
  snap('twoTx', { year: 0, hour: 20, solarMult: 0 }),
  snap('twoTx', { year: 0, hour: 12, solarMult: 1 }),
  snap('synthetic', { year: 0, hour: 20 }),
  snap('synthetic', { year: 3, hour: 12, solarMult: 1.2 }),
  snap('syntheticGrounded', { year: 0, hour: 20 }),
  snap('syntheticGrounded', { year: 0, hour: 12 }),
  { kind: 'scan', variant: 'unbalanced' },
  { kind: 'scan', variant: 'balanced' },
  { kind: 'scan', variant: 'twoTx' },
  { kind: 'scan', variant: 'unbalanced', hours: [12], solarMult: 1 },
  { kind: 'scan', variant: 'synthetic' },
  { kind: 'dailyLoss', variant: 'unbalanced' },
  { kind: 'dailyLoss', variant: 'bess' }
];

export function caseLabel(c) {
  return `${c.kind} ${c.variant}${c.opts ? ' ' + JSON.stringify(c.opts) : ''}${c.hours ? ' hours=' + c.hours.join(',') : ''}`;
}

// Returns a JSON-plain copy so a reference captured from disk and a freshly computed result
// compare like for like (no undefined-vs-missing or Infinity surprises). Multi-hour cases take
// `warmStart` (scans warm-start by default since P1.4; the reference was captured cold, before
// warm starts existed, so `warmStart: false` must reproduce it exactly).
export function computeCase(c, { warmStart = false } = {}) {
  const d = VARIANTS[c.variant]();
  let out;
  if (c.kind === 'snapshot') out = runSnapshot(d, c.opts);
  else if (c.kind === 'scan') out = scanAndSummarize(d, c.hours, c.solarMult, { warmStart });
  else if (c.kind === 'dailyLoss') out = dailyEnergyLossKwh(d, [], { warmStart });
  else throw new Error('unknown case kind ' + c.kind);
  return JSON.parse(JSON.stringify(out));
}
