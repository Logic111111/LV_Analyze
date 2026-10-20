// @ts-check
// Data model: equipment constants and libraries, the default design and its migration
// (withDefaults), network-topology helpers, and the transformer's electrical model.
import { PHASES } from './complex.js';
/** @import { Design, Pole, Transformer, ConductorType, TransformerType, Phase, ConnectionPhase } from './types.js' */

/* ============================================================
   DATA MODEL
============================================================ */
/** @type {Record<number, TransformerType>} */
export const TRANSFORMERS = {
  100: { kVA: 100, z: 0.04, noLoadW: 260 }, 160: { kVA: 160, z: 0.04, noLoadW: 380 },
  250: { kVA: 250, z: 0.04, noLoadW: 530 }, 630: { kVA: 630, z: 0.04, noLoadW: 1200 }
};
/** HV winding voltage per off-load tap position (11 kV nominal, 2.5 % steps). @type {Record<number, number>} */
export const TAPS = { 1: 11275, 2: 11000, 3: 10725, 4: 10450 };
/** @type {Record<string, ConductorType>} */
export const CONDUCTORS = {
  '70ABC': { R: 0.443, L_mH: 0.3, Z: 0.453, I: 203, neutralScale: 70 / 50 },
  '50ABC': { R: 0.641, L_mH: 0.3, Z: 0.647, I: 162, neutralScale: 50 / 35 }
};
// The built-in libraries are frozen: designs carry their own copies (see defaultDesign), so
// nothing should ever write to these shared objects.
Object.values(TRANSFORMERS).forEach(t => Object.freeze(t));
Object.values(CONDUCTORS).forEach(c => Object.freeze(c));
Object.freeze(TRANSFORMERS); Object.freeze(CONDUCTORS);

/* ============================================================
   EQUIPMENT LIBRARIES
============================================================ */
// Every engine lookup of conductor or transformer data goes through these two functions, never
// CONDUCTORS[...] / TRANSFORMERS[...] directly: a design carries its own `conductorLibrary` and
// `transformerLibrary` (seeded with exact copies of the built-ins above by defaultDesign/
// withDefaults, editable later), and a code missing from it falls back to the built-in entry. A
// code found in neither is a data error — reported clearly here rather than surfacing later as a
// "cannot read properties of undefined" deep inside the solver.

/** @param {Design | null | undefined} design @param {string} code @returns {ConductorType} */
export function getConductor(design, code) {
  const lib = design && design.conductorLibrary;
  const c = (lib && lib[code]) || CONDUCTORS[code];
  if (!c) throw new Error(`Unknown conductor "${code}" — it is not in this design's conductor library.`);
  return c;
}

/** @param {Design | null | undefined} design @param {number | string} rating @returns {TransformerType} */
export function getTransformerType(design, rating) {
  const lib = design && design.transformerLibrary;
  const t = (lib && lib[rating]) || TRANSFORMERS[rating];
  if (!t) throw new Error(`Unknown transformer rating "${rating}" kVA — it is not in this design's transformer library.`);
  return t;
}

// Codes / ratings available to this design, built-ins first (in their built-in order), then any
// the design's own library adds — what the pages' pickers offer.
/** @param {Design | null | undefined} design @returns {string[]} */
export function conductorCodes(design) {
  return [...new Set([...Object.keys(CONDUCTORS), ...Object.keys((design && design.conductorLibrary) || {})])];
}
/** @param {Design | null | undefined} design @returns {number[]} */
export function transformerRatings(design) {
  const all = [...Object.keys(TRANSFORMERS), ...Object.keys((design && design.transformerLibrary) || {})].map(Number);
  return [...new Set(all)].sort((a, b) => a - b);
}

// Per-km series impedances of one conductor type. Library entries give R and |Z| (X derived as
// √(|Z|² − R²)) and a neutral-to-phase resistance ratio; the neutral's reactance is taken equal to
// the phase's (thin conductor, close spacing in an aerial bundled cable). An entry may instead give
// X, Rn and/or Xn explicitly — those are used as-is when present (needed once the library is
// user-editable, P2.5). For the two built-in entries this reproduces the original condX/condRn/
// condXn arithmetic exactly.
/** @param {Design | null | undefined} design @param {string} code @returns {{ R: number, X: number, Rn: number, Xn: number, I: number }} Ω/km, A */
export function conductorParams(design, code) {
  const c = /** @type {ConductorType & { X?: number, Rn?: number, Xn?: number }} */ (getConductor(design, code));
  const X = c.X != null ? Number(c.X) : Math.sqrt(Math.max(c.Z * c.Z - c.R * c.R, 0));
  const Rn = c.Rn != null ? Number(c.Rn) : c.R * c.neutralScale;
  const Xn = c.Xn != null ? Number(c.Xn) : X;
  return { R: c.R, X, Rn, Xn, I: c.I };
}

// Kept for existing callers (Setup page): `design` is optional, and without it these read the
// built-in library exactly as before.
/** @param {string} c @param {Design} [design] @returns {number} X, Ω/km */
export function condX(c, design) { return conductorParams(design, c).X; }
/** @param {string} c @param {Design} [design] @returns {number} neutral R, Ω/km */
export function condRn(c, design) { return conductorParams(design, c).Rn; }
/** @param {string} c @param {Design} [design] @returns {number} neutral X, Ω/km */
export function condXn(c, design) { return conductorParams(design, c).Xn; } // assume neutral reactance ~ phase reactance (thin conductor, close spacing)

// Deep copies of the built-in libraries — what a new or migrated design starts with.
function builtInConductorLibrary() { return Object.fromEntries(Object.entries(CONDUCTORS).map(([k, c]) => [k, { ...c }])); }
function builtInTransformerLibrary() { return Object.fromEntries(Object.entries(TRANSFORMERS).map(([k, t]) => [k, { ...t }])); }

export const DEFAULT_LOAD_CURVE = [0.35, 0.30, 0.28, 0.27, 0.28, 0.32, 0.45, 0.55, 0.50, 0.45, 0.42, 0.40, 0.42, 0.40, 0.42, 0.48, 0.60, 0.75, 0.95, 1.00, 1.00, 0.80, 0.60, 0.45];
export const DEFAULT_EV_CURVE = [0.55, 0.45, 0.30, 0.20, 0.15, 0.10, 0.08, 0.10, 0.15, 0.20, 0.20, 0.18, 0.15, 0.15, 0.15, 0.20, 0.35, 0.55, 0.85, 1.00, 0.95, 0.85, 0.70, 0.60];
export const DEFAULT_SOLAR_CURVE = [0, 0, 0, 0, 0, 0, 0.05, 0.20, 0.45, 0.70, 0.88, 0.98, 1.00, 0.98, 0.88, 0.70, 0.45, 0.20, 0.05, 0, 0, 0, 0, 0];
// Commercial shops: cooling/fridges only outside trading hours, ramps up over 08:00-20:00 opening hours.
export const DEFAULT_SHOP_CURVE = [0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.50, 0.70, 0.85, 0.95, 1.00, 1.00, 0.95, 0.90, 0.90, 0.85, 0.75, 0.55, 0.15, 0.15, 0.15, 0.15];
// Public/workplace EV charging stations: daytime-weighted (commuter/workplace/public charging
// through the day), the mirror image of the home-style EV curve above, which peaks evening/overnight.
export const DEFAULT_EVCS_CURVE = [0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.10, 0.25, 0.45, 0.65, 0.80, 0.90, 0.95, 1.00, 0.95, 0.85, 0.70, 0.55, 0.40, 0.25, 0.15, 0.10, 0.08, 0.05];

/** @returns {Design} */
export function defaultDesign() {
  return {
    name: 'Untitled Island',
    transformers: [{ id: 'TX', name: 'TX', txRating: 250, tap: 2, hvActual: 11000, txXR: 3, txGroundOhms: 7.5 }],
    admd: 1.5, pf: 0.95, growth: 3,
    loadModel: 'constant', zipZ: 0.2, zipI: 0.2, zipP: 0.6,
    txNoLoadW: Object.fromEntries(Object.entries(TRANSFORMERS).map(([k, t]) => [k, t.noLoadW])),
    vnom: 230, vdev: 6, maxpv: 5, maxbess: 5, bessRte: 0.90,
    // Standards the results are judged against (grows in P2.3 / P2.7). VUF limit 2 % is the
    // EN 50160 LV value (95 % of 10-min means over a week); counting it as a violation is opt-in.
    // ("Current app defaults" — see engine/standards.js; the voltage band is vnom/vdev above.)
    standards: { profileName: 'Current app defaults', vufLimitPct: 2, vufAsViolation: false, disconnectTimeS: 5, cableLoadingLimitPct: 100, txLoadingLimitPct: 100 },
    // Fault-level inputs (P2.3; see engine/faults.js). Blank HV fault level = infinite source.
    // cMax/cMin are the IEC 60909-0 LV voltage factors for a +6 % tolerance band.
    fault: { hvFaultMVA: null, hvXR: 10, cMax: 1.05, cMin: 0.95, condTempC: 80 },
    // Fuses are user data from manufacturers' time-current curves — the library starts empty and
    // nothing is pre-filled. Feeder head fuses are keyed "<txId>|<feeder>", section fuses by pole.
    fuseLibrary: [],
    // Transformer thermal model (P3.3, engine/thermal.js). The ambient is the flat 20 °C IEC 60076-7
    // reference, not climate data — the UI asks for the site's hourly profile.
    thermal: { ambientC: Array(24).fill(20), oilExponentX: 0.8, windingExponentY: 1.6, lossRatioR: 5, k11: 1.0, k21: 1.0, k22: 2.0, tauOilMin: 180, tauWindingMin: 4, topOilRiseK: 55, hotSpotGradientK: 23 },
    // Smart-inverter PV (P3.1): 'unity' = today's behaviour. Curves seeded with the IEEE 1547-2018
    // Category B defaults, labelled as such in the UI — replace with the local grid code's.
    inverter: { mode: 'unity', voltVarCurve: [[0.92, 0.44], [0.98, 0], [1.02, 0], [1.08, -0.44]], voltWattCurve: [[1.06, 1.0], [1.10, 0.2]], exportLimitKw: null },
    protection: { feederFuses: {}, poleFuses: {} },
    includeGeneral: true, includeEV: true, includeSolar: true, includeShop: true, includeBess: true, includeEVCS: true,
    bessChargeStartHour: 10, bessChargeEndHour: 14, bessDischargeStartHour: 19, bessDischargeEndHour: 23,
    loadCurve: [...DEFAULT_LOAD_CURVE], evCurve: [...DEFAULT_EV_CURVE], solarCurve: [...DEFAULT_SOLAR_CURVE], shopCurve: [...DEFAULT_SHOP_CURVE], evcsCurve: [...DEFAULT_EVCS_CURVE],
    conductorLibrary: builtInConductorLibrary(), transformerLibrary: builtInTransformerLibrary(),
    poles: [
      { id: 'P1', feeder: 'F1', parent: 'TX', spanM: 40, cond: '70ABC', grounded: false, groundOhms: 20 },
      { id: 'P2', feeder: 'F1', parent: 'P1', spanM: 35, cond: '70ABC', grounded: false, groundOhms: 20 },
      { id: 'P3', feeder: 'F1', parent: 'P2', spanM: 35, cond: '50ABC', grounded: false, groundOhms: 20 }
    ],
    loads: [
      { id: 'L1', pole: 'P1', type: 'general', phase: 'A', kva: null },
      { id: 'L2', pole: 'P1', type: 'general', phase: 'B', kva: null },
      { id: 'L3', pole: 'P2', type: 'general', phase: 'C', kva: null },
      { id: 'L4', pole: 'P2', type: 'general', phase: 'A', kva: null },
      { id: 'L5', pole: 'P3', type: 'general', phase: 'B', kva: null },
      { id: 'L6', pole: 'P3', type: 'ev', phase: 'C', kva: 7 }
    ],
    pv: [
      { id: 'S1', pole: 'P2', phase: 'A', kva: 4 },
      { id: 'S2', pole: 'P3', phase: 'B', kva: 5 }
    ],
    bess: [],
    openPoints: []
  };
}

/* ============================================================
   MIGRATION
============================================================ */
// Upgrades a design saved before multi-transformer support (a flat txRating/tap/hvActual/txXR)
// into the current `transformers[]` shape. Non-destructive: a design that already has
// transformers is returned unchanged.
/** @param {any} design @returns {any} */
export function normalizeDesign(design) {
  if (Array.isArray(design.transformers) && design.transformers.length) return design;
  return {
    ...design,
    transformers: [{
      id: 'TX', name: 'TX',
      txRating: design.txRating ?? 250, tap: design.tap ?? 2,
      hvActual: design.hvActual ?? 11000, txXR: design.txXR ?? 3
    }]
  };
}
// The one migration every entry point runs a design through (loading from the server, importing a
// JSON file, starting a new one), so the rest of the app can assume every field exists. Rules:
//   - normalizeDesign first (flat single-transformer format → transformers[]);
//   - a missing scalar setting or curve takes defaultDesign()'s value — exactly what the app
//     already did on load via `{ ...defaultDesign(), ...design }`, so results are unchanged;
//   - a missing collection (poles/loads/pv/bess/openPoints) becomes an empty array, NOT the sample
//     network's contents (the old spread silently injected the sample PV/loads into a design that
//     simply lacked that key);
//   - per-transformer and per-pole fields get the same fallbacks the solver and the Network page
//     already apply (txXR 3, txGroundOhms 7.5 Ω, grounded false, groundOhms 20 Ω).
// Only `undefined` counts as missing — a value that is present (even null) is never overwritten,
// and the input is never mutated. Idempotent: withDefaults(withDefaults(d)) deep-equals
// withDefaults(d). New fields added by later features get their (off-by-default) value here.
const DESIGN_COLLECTIONS = ['poles', 'loads', 'pv', 'bess', 'openPoints', 'fuseLibrary'];
// Settings groups whose individual fields are filled one by one, so a design saved after a group
// existed but before one of its fields did still gets that field's default.
const DESIGN_SETTING_GROUPS = ['standards', 'fault', 'protection', 'inverter', 'thermal'];
/** @param {any} design A saved, imported or partial design. @returns {Design} */
/** @param {any} value @param {Record<string, any>} defaults */
function fillMissing(value, defaults) {
  const out = { ...(value && typeof value === 'object' ? value : {}) };
  Object.keys(defaults).forEach(k => { if (out[k] === undefined) out[k] = defaults[k]; });
  return out;
}

export function withDefaults(design) {
  const base = normalizeDesign(design || {});
  const defaults = defaultDesign();
  const out = { ...base };
  Object.keys(defaults).forEach(k => {
    if (DESIGN_COLLECTIONS.includes(k)) { if (!Array.isArray(out[k])) out[k] = []; }
    else if (DESIGN_SETTING_GROUPS.includes(k)) out[k] = fillMissing(out[k], defaults[k]);
    else if (out[k] === undefined) out[k] = defaults[k];
  });
  out.transformers = out.transformers.map(t => ({
    ...t,
    name: t.name ?? t.id,
    tap: t.tap ?? 2,
    hvActual: t.hvActual ?? 11000,
    txXR: t.txXR ?? 3,
    txGroundOhms: t.txGroundOhms ?? 7.5
  }));
  out.poles = out.poles.map(p => ({ ...p, grounded: p.grounded ?? false, groundOhms: p.groundOhms ?? 20 }));
  return out;
}

/** @param {Design} design @returns {string} */
export function nextTransformerId(design) {
  let n = 2;
  while (design.transformers.some(t => t.id === 'TX' + n)) n++;
  return 'TX' + n;
}

/* ============================================================
   NETWORK HELPERS
============================================================ */
/** @param {Design} design @param {string} id @returns {Pole | undefined} */
export function poleById(design, id) { return design.poles.find(p => p.id === id); }
/** @param {Design} design @param {string} id @returns {string[]} */
export function children(design, id) { return design.poles.filter(p => p.parent === id).map(p => p.id); }
/** @param {Design} design @param {string} id @returns {boolean} */
export function isTransformerId(design, id) { return design.transformers.some(t => t.id === id); }
/** @param {Design} design @param {string} id @returns {Transformer | undefined} */
export function transformerById(design, id) { return design.transformers.find(t => t.id === id); }
// Walks a pole's parent chain up to the transformer bus that ultimately feeds it — used to
// group poles/connections/results by transformer when a design has more than one.
/** @param {Design} design @param {string} poleId @returns {string | null} */
export function transformerOfPole(design, poleId) {
  let cur = poleId;
  while (!isTransformerId(design, cur)) {
    const p = poleById(design, cur);
    if (!p) return null;
    cur = p.parent;
  }
  return cur;
}
/** @param {Design} design @param {string[]} rootIds @returns {string[]} */
export function bfsOrderFrom(design, rootIds) {
  const order = []; const queue = [...rootIds];
  const seen = new Set(queue);
  while (queue.length) {
    const id = queue.shift(); order.push(id);
    for (const c of children(design, id)) { if (!seen.has(c)) { seen.add(c); queue.push(c); } }
  }
  return order;
}
/** @param {Design} design @returns {string[]} */
export function bfsOrder(design) {
  const roots = design.poles.filter(p => isTransformerId(design, p.parent)).map(p => p.id);
  return bfsOrderFrom(design, roots);
}
/** @param {Design} design @returns {string[]} */
export function feederRoots(design) { return [...new Set(design.poles.filter(p => isTransformerId(design, p.parent)).map(p => p.feeder))]; }

// Tree-path distance (sum of spanM) between any two poles fed from the same transformer, or
// `null` if they're on different transformers (there's no path — this is a forest of disjoint
// trees, not a meshed network). Walks up from `poleIdX` recording each ancestor's distance from
// X (stopping once the transformer root itself is recorded), then walks up from `poleIdY`
// accumulating distance until it hits an id already in that map — the lowest common ancestor,
// which may be the shared transformer itself. This is what lets a connector cable's length be
// *derived* from a common open point's real position instead of guessed.
/** @param {Design} design @param {string} poleIdX @param {string} poleIdY @returns {number | null} */
export function polePathDistanceM(design, poleIdX, poleIdY) {
  if (poleIdX === poleIdY) return 0;
  const fromX = new Map();
  let cur = poleIdX, dist = 0;
  fromX.set(cur, 0);
  while (!isTransformerId(design, cur)) {
    const p = poleById(design, cur);
    dist += p.spanM;
    cur = p.parent;
    fromX.set(cur, dist);
  }
  cur = poleIdY; dist = 0;
  while (!fromX.has(cur)) {
    if (isTransformerId(design, cur)) return null; // reached Y's own transformer without meeting X's chain
    const p = poleById(design, cur);
    dist += p.spanM;
    cur = p.parent;
  }
  return fromX.get(cur) + dist;
}

// Connected load and installed solar PV (kVA per phase) for every feeder in the design, grouped by
// the actual feeder tree — the (transformer, feeder name) of a root pole plus everything downstream
// of it — rather than by each pole's own `feeder` string, so two different transformers' identically
// named feeders (e.g. a new transformer's "F1" and the original one's) are never merged. Loads are
// ADMD-substituted where kVA is unspecified (same convention as everywhere else); PV is nameplate
// kVA (not curve-scaled) — "how much is connected", not "how much is generating right now". A
// three-phase (ABC) connection splits evenly across A/B/C. Used by both the network diagram's
// per-feeder labels and the Feeder Split preview table.
/**
 * @param {Design} design
 * @returns {{ key: string, txId: string, feederName: string, roots: string[], poleIds: string[], load: import('./types.js').PhaseMap<number>, pv: import('./types.js').PhaseMap<number> }[]}
 */
export function feederConnectedTotals(design) {
  const groups = new Map();
  design.poles.filter(p => isTransformerId(design, p.parent)).forEach(root => {
    const key = root.parent + '|' + root.feeder;
    let g = groups.get(key);
    if (!g) {
      g = { key, txId: root.parent, feederName: root.feeder, roots: [], poleIds: [], load: { A: 0, B: 0, C: 0 }, pv: { A: 0, B: 0, C: 0 } };
      groups.set(key, g);
    }
    g.roots.push(root.id);
  });
  const add = (bucket, phase, kva) => {
    if (phase === 'ABC') PHASES.forEach(ph => { bucket[ph] += kva / 3; });
    else bucket[phase] += kva;
  };
  groups.forEach(g => {
    g.poleIds = bfsOrderFrom(design, g.roots);
    const inGroup = new Set(g.poleIds);
    design.loads.forEach(l => {
      if (inGroup.has(l.pole)) add(g.load, l.phase, (l.kva == null || l.kva === '') ? design.admd : Number(l.kva));
    });
    design.pv.forEach(p => { if (inGroup.has(p.pole)) add(g.pv, p.phase, Number(p.kva)); });
  });
  return [...groups.values()];
}

/* ============================================================
   TRANSFORMER MODEL
============================================================ */
/** Open-circuit LV phase-neutral voltage at this tap and HV supply. @param {Transformer} tx @returns {number} V */
export function secondaryLNVoltage(tx) {
  const vLN = 415 / Math.sqrt(3);
  return vLN * (tx.hvActual / TAPS[tx.tap]);
}

// Series transformer impedance, referred to the LV side, expressed as an equivalent per-phase
// (line-neutral) impedance so it can be added in series with each feeder root. X/R split is a
// modelling assumption (no factory test-certificate X/R was provided) — default 3, editable.
/** @param {Transformer} tx @param {Design} [design] Library source (built-ins when omitted). @returns {{ r: number, x: number, z: number }} Ω per phase, referred to LV */
export function txImpedance(tx, design) {
  const zpu = getTransformerType(design, tx.txRating).z;
  const zbase = Math.pow(415, 2) / (tx.txRating * 1000);
  const z = zpu * zbase;
  const xr = tx.txXR || 3;
  const r = z / Math.sqrt(1 + xr * xr);
  const x = z * xr / Math.sqrt(1 + xr * xr);
  return { r, x, z };
}
