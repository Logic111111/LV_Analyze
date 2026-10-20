// Guided new-design wizard (P5.8): pure functions that turn the wizard's answers into a design and
// check them, so the steps are testable without the UI.
//   transformer → feeders and poles (generated as radial chains, then editable) → customers (bulk,
//   per pole) → PV / EV (counts and sizes the user enters) → review and run.
// No engineering numbers are made up: PV and EV sizes are whatever the user enters (zero units if
// left blank), loads without a kVA use the design's ADMD as everywhere else, and the conductor must
// be one with complete data in the library.
import { defaultDesign, getConductor, conductorIssues, transformerRatings, LONG_SPAN_M } from './loadflow.js';

/** Poles for each feeder as a radial chain from the transformer: P1…Pn numbered across feeders. */
export function generatePoles(feeders, txId = 'TX') {
  const poles = [];
  let n = 0;
  feeders.forEach(f => {
    let parent = txId;
    for (let i = 0; i < Math.max(0, Math.floor(Number(f.poles) || 0)); i++) {
      const id = 'P' + (++n);
      poles.push({ id, feeder: f.name || 'F1', parent, spanM: Number(f.spanM) || 0, cond: f.cond, grounded: false, groundOhms: 20 });
      parent = id;
    }
  });
  return poles;
}

/**
 * Customers per pole. phase 'distribute' rotates A → B → C across the whole island (continuing
 * from pole to pole), the usual first-cut practice; a single letter puts them all on that phase.
 */
export function generateCustomers(poles, perPole, phase = 'distribute', kva = '') {
  const loads = [];
  let k = 0, n = 0;
  poles.forEach(p => {
    const count = Math.max(0, Math.floor(Number(perPole[p.id] ?? 0)));
    for (let i = 0; i < count; i++) {
      const ph = phase === 'distribute' ? ['A', 'B', 'C'][k++ % 3] : phase;
      loads.push({ id: 'L' + (++n), pole: p.id, type: 'general', phase: ph, kva: kva === '' || kva == null ? null : Number(kva) });
    }
  });
  return loads;
}

/** `count` units spread evenly over the customers (every customers/count-th one), on its pole and phase. */
function spread(customers, count) {
  const c = Math.min(Math.max(0, Math.floor(Number(count) || 0)), customers.length);
  if (!c) return [];
  const step = customers.length / c;
  return Array.from({ length: c }, (_, i) => customers[Math.floor(i * step)]);
}

/** @param {any} w wizard state @returns {any} design (not yet through withDefaults) */
export function buildWizardDesign(w) {
  const d = defaultDesign();
  d.name = w.name || 'New design';
  d.transformers = [{ id: 'TX', name: w.tx.name || 'TX', txRating: Number(w.tx.txRating), tap: Number(w.tx.tap), hvActual: Number(w.tx.hvActual), txXR: Number(w.tx.txXR), txGroundOhms: Number(w.tx.txGroundOhms) }];
  d.poles = w.poles.map(p => ({ ...p, spanM: Number(p.spanM) }));
  const customers = generateCustomers(d.poles, w.customers.perPole, w.customers.phase, w.customers.kva);
  const evs = Number(w.ev.kva) > 0 ? spread(customers, w.ev.count).map((c, i) => ({ id: 'EV' + (i + 1), pole: c.pole, type: 'ev', phase: c.phase, kva: Number(w.ev.kva) })) : [];
  d.loads = [...customers, ...evs];
  d.pv = Number(w.pv.kva) > 0 ? spread(customers, w.pv.count).map((c, i) => ({ id: 'PV' + (i + 1), pole: c.pole, phase: c.phase, kva: Number(w.pv.kva) })) : [];
  d.bess = [];
  d.openPoints = [];
  return d;
}

/**
 * Inline validation: errors block "Create", warnings don't.
 * @param {any} w @param {any} library a design whose conductor/transformer libraries apply
 * @returns {{ step: number, level: 'error' | 'warning', text: string }[]}
 */
export function validateWizard(w, library) {
  const out = [];
  const err = (step, text) => out.push({ step, level: 'error', text });
  const warn = (step, text) => out.push({ step, level: 'warning', text });
  if (!transformerRatings(library).includes(Number(w.tx.txRating))) err(1, `Transformer rating ${w.tx.txRating} kVA is not in the transformer library.`);
  if (!(Number(w.tx.hvActual) > 0)) err(1, 'Enter the HV supply voltage.');
  if (!w.poles.length) err(2, 'Add at least one feeder with at least one pole.');
  const condChecked = new Set();
  w.poles.forEach(p => {
    if (!(Number(p.spanM) > 0)) err(2, `${p.id}: span length must be more than 0 m.`);
    else if (Number(p.spanM) > LONG_SPAN_M) warn(2, `${p.id}: ${p.spanM} m is a long LV span (over ${LONG_SPAN_M} m) — check it.`);
    if (!condChecked.has(p.cond)) {
      condChecked.add(p.cond);
      const issues = conductorIssues(getConductor(library, p.cond));
      if (issues.length) err(2, `Conductor ${p.cond}: data missing (${issues.join(', ')}). Complete it in the conductor library or pick another.`);
    }
  });
  const total = w.poles.reduce((s, p) => s + Math.max(0, Math.floor(Number(w.customers.perPole[p.id] ?? 0))), 0);
  if (!total) warn(3, 'No customers yet — the load flow will show an unloaded network.');
  const admd = w.customers.kva === '' || w.customers.kva == null ? Number(library.admd) : Number(w.customers.kva);
  if (total * admd > Number(w.tx.txRating)) warn(3, `${total} customers × ${admd} kVA = ${(total * admd).toFixed(1)} kVA exceeds the ${w.tx.txRating} kVA transformer.`);
  if (Number(w.pv.count) > 0 && !(Number(w.pv.kva) > 0)) err(4, 'Enter the PV system size (kVA), or set the PV count to 0.');
  if (Number(w.ev.count) > 0 && !(Number(w.ev.kva) > 0)) err(4, 'Enter the EV charger size (kVA), or set the EV count to 0.');
  if (Number(w.pv.count) > total) warn(4, `More PV systems (${w.pv.count}) than customers (${total}); capped at ${total}.`);
  if (Number(w.ev.count) > total) warn(4, `More EVs (${w.ev.count}) than customers (${total}); capped at ${total}.`);
  return out;
}

/** A fresh wizard state from the library defaults (nothing engineering-specific assumed). */
export function initialWizard(library) {
  const ratings = transformerRatings(library);
  return {
    name: 'New design',
    tx: { name: 'TX', txRating: ratings.includes(100) ? 100 : ratings[0], tap: 2, hvActual: 11000, txXR: 3, txGroundOhms: 7.5 },
    feeders: [{ name: 'F1', poles: 3, spanM: 40, cond: '70ABC' }],
    poles: [],
    customers: { perPole: {}, defaultPerPole: 4, phase: 'distribute', kva: '' },
    pv: { count: 0, kva: '' },
    ev: { count: 0, kva: '' }
  };
}
