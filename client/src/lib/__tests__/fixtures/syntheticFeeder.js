import { defaultDesign } from '../../loadflow.js';

// Deterministic synthetic LV island for benchmarks and the larger reference-lock cases: one
// 630 kVA transformer, four feeders with side branches (default 50 poles), and a mix of general,
// EV, shop, PV and BESS connections (default 200). Not a real network — its job is to be the size
// the brief's performance budget is stated for ("50 poles and 200 connections"), to exercise every
// connection type, and (with `grounded`) the nodal neutral solve on a realistically sized matrix.
// Seeded, so the same arguments always build the same design.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function syntheticFeeder({ poles = 50, connections = 200, grounded = false, seed = 1 } = {}) {
  const rnd = mulberry32(seed);
  const d = defaultDesign();
  d.name = `Synthetic ${poles} poles / ${connections} connections${grounded ? ' (grounded)' : ''}`;
  d.transformers = [{ id: 'TX', name: 'TX', txRating: 630, tap: 2, hvActual: 11000, txXR: 3, txGroundOhms: 7.5 }];
  d.poles = [];
  const FEEDERS = 4;
  const lastOnFeeder = {};
  const countOnFeeder = {};
  for (let i = 1; i <= poles; i++) {
    const f = 'F' + (((i - 1) % FEEDERS) + 1);
    const k = (countOnFeeder[f] = (countOnFeeder[f] || 0) + 1);
    // Every 5th pole on a feeder tees off two poles back, so the trees have side branches.
    let parent = lastOnFeeder[f] ? lastOnFeeder[f][lastOnFeeder[f].length - 1] : 'TX';
    if (k % 5 === 0 && lastOnFeeder[f].length >= 2) parent = lastOnFeeder[f][lastOnFeeder[f].length - 2];
    const id = 'P' + i;
    d.poles.push({
      id, feeder: f, parent, spanM: 28 + Math.round(rnd() * 12), cond: k <= 6 ? '70ABC' : '50ABC',
      grounded: grounded && (k === 7 || k === 12), groundOhms: 20
    });
    (lastOnFeeder[f] = lastOnFeeder[f] || []).push(id);
  }
  d.loads = []; d.pv = []; d.bess = [];
  const PH = ['A', 'B', 'C'];
  for (let i = 0; i < connections; i++) {
    const pole = 'P' + (1 + Math.floor(rnd() * poles));
    // Slightly A-heavy, like a real unbalanced feeder.
    const r = rnd();
    const phase = r < 0.42 ? 'A' : r < 0.72 ? 'B' : 'C';
    const kind = i % 20;
    if (kind < 14) d.loads.push({ id: 'L' + i, pole, type: 'general', phase, kva: null });
    else if (kind === 14) d.loads.push({ id: 'L' + i, pole, type: 'ev', phase, kva: 7 });
    else if (kind === 15) d.loads.push({ id: 'L' + i, pole, type: 'shop', phase: 'ABC', kva: 6 + Math.round(rnd() * 6) });
    else if (kind === 16) d.bess.push({ id: 'B' + i, pole, phase, kva: 3 });
    else d.pv.push({ id: 'S' + i, pole, phase: PH[i % 3], kva: 3 + Math.round(rnd() * 2) });
  }
  return d;
}
