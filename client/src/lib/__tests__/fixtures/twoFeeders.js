import { defaultDesign } from '../../loadflow.js';

// Two 12-pole feeders from one 100 kVA transformer that meet at a normally-open point between
// their far ends — the O5 dual-feeder test network. Loads are seeded (mulberry32), so the design
// is the same on every run; the far ends are heavy enough that both feeders sag below the band.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function twoFeeders(seed = 3) {
  const rnd = mulberry32(seed);
  const d = defaultDesign();
  d.name = 'Two feeders';
  d.transformers = [{ ...d.transformers[0], id: 'TX', txRating: 100, hvActual: 10800 }];
  d.poles = []; d.loads = []; d.pv = []; d.bess = [];
  let n = 0;
  for (const f of ['A', 'B']) {
    for (let i = 1; i <= 12; i++) {
      d.poles.push({ id: f + i, feeder: f === 'A' ? 'F1' : 'F2', parent: i === 1 ? 'TX' : f + (i - 1), spanM: 35 + Math.round(rnd() * 15), cond: i <= 4 ? '70ABC' : '50ABC', grounded: false, groundOhms: 20 });
      const k = 1 + Math.floor(rnd() * 3);
      for (let j = 0; j < k; j++) d.loads.push({ id: 'L' + (++n), pole: f + i, type: 'general', phase: 'ABC'[Math.floor(rnd() * 3)], kva: null });
    }
  }
  d.openPoints = [{ id: 'OP1', poleA: 'A12', poleB: 'B12', spanM: 30, cond: '70ABC' }];
  return d;
}
