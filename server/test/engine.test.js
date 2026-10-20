// P7.1 — the server loads the shared engine package (ESM) from CommonJS and gets the same answer
// the client does: the Walkthrough Island golden P3 A voltage at 20:00.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEngine } = require('../src/engine');

test('loads the engine and solves the golden fixture', async () => {
  const e = await loadEngine();
  assert.equal(typeof e.runSnapshot, 'function');
  assert.equal(await loadEngine(), e); // loaded once
  const d = e.defaultDesign();
  d.transformers = [{ ...d.transformers[0], txRating: 100, hvActual: 10800 }];
  d.poles = d.poles.map(p => (p.id === 'P2' || p.id === 'P3') ? { ...p, spanM: 60 } : p);
  let n = d.loads.length;
  for (let i = 0; i < 5; i++) d.loads.push({ id: 'L' + (++n), pole: 'P2', type: 'general', phase: 'A', kva: null });
  for (let i = 0; i < 6; i++) d.loads.push({ id: 'L' + (++n), pole: 'P3', type: 'general', phase: 'A', kva: null });
  d.loads.push({ id: 'L' + (++n), pole: 'P3', type: 'ev', phase: 'A', kva: 7 });
  const r = e.runSnapshot(e.withDefaults(d), { year: 0, hour: 20, solarMult: 0 });
  assert.ok(Math.abs(r.poleResults.find(p => p.id === 'P3').volt.A - 212.9) < 0.05);
});
