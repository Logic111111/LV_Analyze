/* ============================================================
   DATA MODEL
============================================================ */
export const TRANSFORMERS = {
  100: { kVA: 100, z: 0.04, noLoadW: 260 }, 160: { kVA: 160, z: 0.04, noLoadW: 380 },
  250: { kVA: 250, z: 0.04, noLoadW: 530 }, 630: { kVA: 630, z: 0.04, noLoadW: 1200 }
};
export const TAPS = { 1: 11275, 2: 11000, 3: 10725, 4: 10450 };
export const CONDUCTORS = {
  '70ABC': { R: 0.443, L_mH: 0.3, Z: 0.453, I: 203, neutralScale: 70 / 50 },
  '50ABC': { R: 0.641, L_mH: 0.3, Z: 0.647, I: 162, neutralScale: 50 / 35 }
};
export function condX(c) { const z = CONDUCTORS[c].Z, r = CONDUCTORS[c].R; return Math.sqrt(Math.max(z * z - r * r, 0)); }
export function condRn(c) { return CONDUCTORS[c].R * CONDUCTORS[c].neutralScale; }
export function condXn(c) { return condX(c); } // assume neutral reactance ~ phase reactance (thin conductor, close spacing)

export const DEFAULT_LOAD_CURVE = [0.35, 0.30, 0.28, 0.27, 0.28, 0.32, 0.45, 0.55, 0.50, 0.45, 0.42, 0.40, 0.42, 0.40, 0.42, 0.48, 0.60, 0.75, 0.95, 1.00, 1.00, 0.80, 0.60, 0.45];
export const DEFAULT_EV_CURVE = [0.55, 0.45, 0.30, 0.20, 0.15, 0.10, 0.08, 0.10, 0.15, 0.20, 0.20, 0.18, 0.15, 0.15, 0.15, 0.20, 0.35, 0.55, 0.85, 1.00, 0.95, 0.85, 0.70, 0.60];
export const DEFAULT_SOLAR_CURVE = [0, 0, 0, 0, 0, 0, 0.05, 0.20, 0.45, 0.70, 0.88, 0.98, 1.00, 0.98, 0.88, 0.70, 0.45, 0.20, 0.05, 0, 0, 0, 0, 0];
// Commercial shops: cooling/fridges only outside trading hours, ramps up over 08:00-20:00 opening hours.
export const DEFAULT_SHOP_CURVE = [0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.15, 0.50, 0.70, 0.85, 0.95, 1.00, 1.00, 0.95, 0.90, 0.90, 0.85, 0.75, 0.55, 0.15, 0.15, 0.15, 0.15];
// Public/workplace EV charging stations: daytime-weighted (commuter/workplace/public charging
// through the day), the mirror image of the home-style EV curve above, which peaks evening/overnight.
export const DEFAULT_EVCS_CURVE = [0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.10, 0.25, 0.45, 0.65, 0.80, 0.90, 0.95, 1.00, 0.95, 0.85, 0.70, 0.55, 0.40, 0.25, 0.15, 0.10, 0.08, 0.05];

export function defaultDesign() {
  return {
    name: 'Untitled Island',
    transformers: [{ id: 'TX', name: 'TX', txRating: 250, tap: 2, hvActual: 11000, txXR: 3, txGroundOhms: 7.5 }],
    admd: 1.5, pf: 0.95, growth: 3,
    loadModel: 'constant', zipZ: 0.2, zipI: 0.2, zipP: 0.6,
    txNoLoadW: Object.fromEntries(Object.entries(TRANSFORMERS).map(([k, t]) => [k, t.noLoadW])),
    vnom: 230, vdev: 6, maxpv: 5, maxbess: 5, bessRte: 0.90,
    includeGeneral: true, includeEV: true, includeSolar: true, includeShop: true, includeBess: true, includeEVCS: true,
    bessChargeStartHour: 10, bessChargeEndHour: 14, bessDischargeStartHour: 19, bessDischargeEndHour: 23,
    loadCurve: [...DEFAULT_LOAD_CURVE], evCurve: [...DEFAULT_EV_CURVE], solarCurve: [...DEFAULT_SOLAR_CURVE], shopCurve: [...DEFAULT_SHOP_CURVE], evcsCurve: [...DEFAULT_EVCS_CURVE],
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
   COMPLEX NUMBER HELPERS
============================================================ */
export const C = {
  add: (a, b) => ({ re: a.re + b.re, im: a.im + b.im }),
  sub: (a, b) => ({ re: a.re - b.re, im: a.im - b.im }),
  mul: (a, b) => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re }),
  mulS: (a, s) => ({ re: a.re * s, im: a.im * s }),
  conj: (a) => ({ re: a.re, im: -a.im }),
  abs: (a) => Math.hypot(a.re, a.im),
  div: (a, b) => { const d = b.re * b.re + b.im * b.im; return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d }; },
  fromPolar: (mag, deg) => ({ re: mag * Math.cos(deg * Math.PI / 180), im: mag * Math.sin(deg * Math.PI / 180) }),
  zero: () => ({ re: 0, im: 0 })
};
export const PHASES = ['A', 'B', 'C'];
const PHASE_ANGLE = { A: 0, B: -120, C: 120 };

// Gaussian elimination with partial pivoting over a complex N×N system Y·x = J. Used only for
// the neutral/ground nodal-admittance solve below — small N (poles per transformer subtree), so
// this direct method is plenty fast without needing a sparse/iterative solver.
export function solveComplexLinearSystem(Y, J) {
  const n = J.length;
  const A = Y.map(row => row.map(v => ({ ...v })));
  const b = J.map(v => ({ ...v }));
  for (let col = 0; col < n; col++) {
    let pivot = col, pivotMag = C.abs(A[col][col]);
    for (let r = col + 1; r < n; r++) {
      const m = C.abs(A[r][col]);
      if (m > pivotMag) { pivot = r; pivotMag = m; }
    }
    if (pivot !== col) { [A[col], A[pivot]] = [A[pivot], A[col]]; [b[col], b[pivot]] = [b[pivot], b[col]]; }
    const diag = A[col][col];
    for (let r = col + 1; r < n; r++) {
      if (A[r][col].re === 0 && A[r][col].im === 0) continue;
      const factor = C.div(A[r][col], diag);
      for (let c = col; c < n; c++) A[r][c] = C.sub(A[r][c], C.mul(factor, A[col][c]));
      b[r] = C.sub(b[r], C.mul(factor, b[col]));
    }
  }
  const x = new Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let sum = b[r];
    for (let c = r + 1; c < n; c++) sum = C.sub(sum, C.mul(A[r][c], x[c]));
    x[r] = C.div(sum, A[r][r]);
  }
  return x;
}

/* ============================================================
   MIGRATION
============================================================ */
// Upgrades a design saved before multi-transformer support (a flat txRating/tap/hvActual/txXR)
// into the current `transformers[]` shape. Non-destructive: a design that already has
// transformers is returned unchanged.
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
export function nextTransformerId(design) {
  let n = 2;
  while (design.transformers.some(t => t.id === 'TX' + n)) n++;
  return 'TX' + n;
}

/* ============================================================
   NETWORK HELPERS
============================================================ */
export function poleById(design, id) { return design.poles.find(p => p.id === id); }
export function children(design, id) { return design.poles.filter(p => p.parent === id).map(p => p.id); }
export function isTransformerId(design, id) { return design.transformers.some(t => t.id === id); }
export function transformerById(design, id) { return design.transformers.find(t => t.id === id); }
// Walks a pole's parent chain up to the transformer bus that ultimately feeds it — used to
// group poles/connections/results by transformer when a design has more than one.
export function transformerOfPole(design, poleId) {
  let cur = poleId;
  while (!isTransformerId(design, cur)) {
    const p = poleById(design, cur);
    if (!p) return null;
    cur = p.parent;
  }
  return cur;
}
export function bfsOrderFrom(design, rootIds) {
  const order = []; const queue = [...rootIds];
  const seen = new Set(queue);
  while (queue.length) {
    const id = queue.shift(); order.push(id);
    for (const c of children(design, id)) { if (!seen.has(c)) { seen.add(c); queue.push(c); } }
  }
  return order;
}
export function bfsOrder(design) {
  const roots = design.poles.filter(p => isTransformerId(design, p.parent)).map(p => p.id);
  return bfsOrderFrom(design, roots);
}
export function feederRoots(design) { return [...new Set(design.poles.filter(p => isTransformerId(design, p.parent)).map(p => p.feeder))]; }

/* ============================================================
   LOAD FLOW SOLVER  (ladder / backward-forward sweep, 4-wire multi-grounded neutral)
============================================================ */
export function secondaryLNVoltage(tx) {
  const vLN = 415 / Math.sqrt(3);
  return vLN * (tx.hvActual / TAPS[tx.tap]);
}

// Series transformer impedance, referred to the LV side, expressed as an equivalent per-phase
// (line-neutral) impedance so it can be added in series with each feeder root. X/R split is a
// modelling assumption (no factory test-certificate X/R was provided) — default 3, editable.
export function txImpedance(tx) {
  const zpu = TRANSFORMERS[tx.txRating].z;
  const zbase = Math.pow(415, 2) / (tx.txRating * 1000);
  const z = zpu * zbase;
  const xr = tx.txXR || 3;
  const r = z / Math.sqrt(1 + xr * xr);
  const x = z * xr / Math.sqrt(1 + xr * xr);
  return { r, x, z };
}

function loadKvaAt(design, load, year, hour) {
  const curve = load.type === 'ev' ? design.evCurve : load.type === 'shop' ? design.shopCurve : load.type === 'evcs' ? design.evcsCurve : design.loadCurve;
  const base = (load.kva == null || load.kva === '') ? design.admd : Number(load.kva);
  const growthFactor = Math.pow(1 + design.growth / 100, year);
  return base * curve[hour] * growthFactor;
}
function pvKvaAt(design, pv, hour) { return Number(pv.kva) * design.solarCurve[hour]; }

// Hours in [start, end), wrapping past midnight if end <= start (empty if start === end).
export function rangeHours(start, end) {
  const span = end === start ? 0 : (((end - start) % 24) + 24) % 24 || 24;
  return [...Array(span).keys()].map(i => (start + i) % 24);
}

// BESS is a fixed-power charge/discharge schedule (no state-of-charge tracking): +1 while
// discharging (behaves like PV export), -1 while charging (behaves like a unity-pf load), 0
// otherwise. Windows are whole clock hours since the engine solves one snapshot per hour.
export function bessMultiplierAt(design, hour) {
  if (rangeHours(design.bessChargeStartHour, design.bessChargeEndHour).includes(hour)) return -1;
  if (rangeHours(design.bessDischargeStartHour, design.bessDischargeEndHour).includes(hour)) return 1;
  return 0;
}

// Per-pole net complex power injection at a given hour/year, split into `loadS` (general/EV/shop
// connections — positive, the only injections the ZIP voltage-dependence below ever applies to)
// and `otherS` (rooftop PV and BESS charge/discharge — always constant-power, since a ZIP mix
// describes end-use demand, not grid-tied inverter behaviour). Shared across every transformer's
// subtree since it only depends on which poles a load/PV/BESS sits on, not which transformer
// feeds them.
function netS(design, poleId, year, hour, loadMult, solarMult, extraPV, extraBess = []) {
  const loadS = { A: C.zero(), B: C.zero(), C: C.zero() };
  const otherS = { A: C.zero(), B: C.zero(), C: C.zero() };
  const addTo = (bucket, phase, kva, pf, sign) => {
    const p = kva * pf, q = kva * Math.sqrt(Math.max(1 - pf * pf, 0)) * sign;
    const s = { re: p * sign, im: q };
    if (phase === 'ABC') { PHASES.forEach(ph => { bucket[ph] = C.add(bucket[ph], C.mulS(s, 1 / 3)); }); }
    else { bucket[phase] = C.add(bucket[phase], s); }
  };
  if (design.includeGeneral) {
    design.loads.filter(l => l.pole === poleId && l.type === 'general').forEach(l => {
      addTo(loadS, l.phase, loadKvaAt(design, l, year, hour) * loadMult, design.pf, +1);
    });
  }
  if (design.includeEV) {
    design.loads.filter(l => l.pole === poleId && l.type === 'ev').forEach(l => {
      addTo(loadS, l.phase, loadKvaAt(design, l, year, hour) * loadMult, design.pf, +1);
    });
  }
  if (design.includeShop) {
    design.loads.filter(l => l.pole === poleId && l.type === 'shop').forEach(l => {
      addTo(loadS, l.phase, loadKvaAt(design, l, year, hour) * loadMult, design.pf, +1);
    });
  }
  if (design.includeEVCS) {
    design.loads.filter(l => l.pole === poleId && l.type === 'evcs').forEach(l => {
      addTo(loadS, l.phase, loadKvaAt(design, l, year, hour) * loadMult, design.pf, +1);
    });
  }
  if (design.includeSolar) {
    design.pv.filter(p => p.pole === poleId).forEach(p => {
      addTo(otherS, p.phase, pvKvaAt(design, p, hour) * solarMult, 1.0, -1);
    });
  }
  extraPV.filter(p => p.pole === poleId).forEach(p => {
    addTo(otherS, p.phase, Number(p.kva) * solarMult, 1.0, -1);
  });
  // Round-trip efficiency is modelled as a derate on the discharge (export) side only — charge
  // draw from the grid stays at the connection's full rated kVA (that's genuinely what gets
  // pulled from the network), while discharge output is scaled down by bessRte. With no
  // state-of-charge tracking there's no real "energy in vs. energy out" to split the loss across,
  // so this is the standard simplification: the round-trip loss shows up as reduced usable output.
  const rte = design.bessRte ?? 1;
  if (design.includeBess) {
    design.bess.filter(b => b.pole === poleId).forEach(b => {
      const mult = bessMultiplierAt(design, hour);
      if (mult > 0) addTo(otherS, b.phase, Number(b.kva) * mult * rte, 1.0, -1);
      else if (mult < 0) addTo(otherS, b.phase, Number(b.kva) * Math.abs(mult), 1.0, +1);
    });
  }
  extraBess.filter(b => b.pole === poleId).forEach(b => {
    const mult = bessMultiplierAt(design, hour);
    if (mult > 0) addTo(otherS, b.phase, Number(b.kva) * mult * rte, 1.0, -1);
    else if (mult < 0) addTo(otherS, b.phase, Number(b.kva) * Math.abs(mult), 1.0, +1);
  });
  return { loadS, otherS };
}

// ZIP voltage-dependence multiplier: P(V) = P0·[aZ·(V/V0)² + aI·(V/V0) + aP], and the same ratio
// applied to Q too (one shared coefficient set, rather than separate ones for P and Q, to keep
// the Setup page to a single control — a deliberate simplification of the general ZIP model).
// V0 is the nominal phase-neutral voltage (design.vnom). Constant-power mode (the historical,
// still-default behaviour) is exactly aZ=0, aI=0, aP=1 — this returns 1 unconditionally whenever
// design.loadModel isn't 'zip', so every existing design's results are unaffected.
function zipMultiplier(design, vAbs) {
  if (design.loadModel !== 'zip') return 1;
  const r = vAbs / design.vnom;
  return (design.zipZ ?? 0) * r * r + (design.zipI ?? 0) * r + (design.zipP ?? 1);
}

// Solves one transformer's subtree (it never electrically touches any other transformer's
// subtree — this is a forest of radial trees, not a meshed network — so each can be solved
// independently with the original single-TX backward-forward sweep).
function solveTxSubtree(design, tx, opts) {
  const { year, hour, loadMult, solarMult, extraPV, extraBess = [] } = opts;
  const V0 = secondaryLNVoltage(tx);
  const V0ph = { A: C.fromPolar(V0, PHASE_ANGLE.A), B: C.fromPolar(V0, PHASE_ANGLE.B), C: C.fromPolar(V0, PHASE_ANGLE.C) };
  const feederRootIds = design.poles.filter(p => p.parent === tx.id).map(p => p.id);
  const order = bfsOrderFrom(design, feederRootIds);
  const parentOf = {}; order.forEach(id => parentOf[id] = poleById(design, id).parent);
  const kidsOf = {}; order.forEach(id => kidsOf[id] = children(design, id));

  const V = {}; order.forEach(id => V[id] = { A: { ...V0ph.A }, B: { ...V0ph.B }, C: { ...V0ph.C } });
  let Icum = {};
  const spanZ = {};
  order.forEach(id => {
    const p = poleById(design, id);
    const km = p.spanM / 1000;
    spanZ[id] = {
      Zph: { re: CONDUCTORS[p.cond].R * km, im: condX(p.cond) * km },
      Zn: { re: condRn(p.cond) * km, im: condXn(p.cond) * km }
    };
  });

  const txZ = txImpedance(tx);
  const txZc = { re: txZ.r, im: txZ.x };
  let Vbus = { A: { ...V0ph.A }, B: { ...V0ph.B }, C: { ...V0ph.C } };
  let Itot = { A: C.zero(), B: C.zero(), C: C.zero() };

  // Poles with an earth electrode at their neutral. When none exist in this subtree, the nodal
  // solve below never runs at all — the loop falls straight back to the original single
  // Zn·In-per-span formula, unchanged from before this feature existed, so an ungrounded design's
  // results are provably unaffected by any of this. The transformer's own star point is *also*
  // permanently earthed (txGroundOhms) — but a single ground point anywhere in an otherwise
  // radial network only sets an absolute potential nothing here measures (phase-to-*local*-
  // neutral readings are unaffected by it), so it only needs to enter the solve once there's a
  // *second* ground point (a pole) for current to genuinely split between.
  const groundedIds = order.filter(id => { const p = poleById(design, id); return p.grounded && Number(p.groundOhms) > 0; });
  const nodeIdx = {}; order.forEach((id, i) => nodeIdx[id] = i);
  const txNodeIdx = order.length; // the transformer bus's own row/column, appended after all poles
  const RgTx = Number(tx.txGroundOhms) || 7.5;
  // Once a pole is grounded, the neutral stops being a simple per-span series chain to the
  // transformer — the earth electrode is a second path to (true) earth, so the neutral conductors
  // form a small network (poles *and the transformer bus* as nodes, spans as series admittance
  // 1/Zn, the transformer's and any grounded pole's earth electrode as a shunt admittance 1/Rg to
  // that earth reference) solved each iteration for every node's neutral voltage Vn relative to
  // true earth — including the transformer's own, which is no longer assumed to be a fixed 0V.
  let Ymat = null;
  if (groundedIds.length) {
    const n = order.length + 1;
    Ymat = Array.from({ length: n }, () => Array.from({ length: n }, () => C.zero()));
    order.forEach(id => {
      const ySpan = C.div({ re: 1, im: 0 }, spanZ[id].Zn);
      const i = nodeIdx[id];
      const parent = parentOf[id];
      const j = parent === tx.id ? txNodeIdx : nodeIdx[parent];
      Ymat[i][i] = C.add(Ymat[i][i], ySpan);
      Ymat[j][j] = C.add(Ymat[j][j], ySpan);
      Ymat[i][j] = C.sub(Ymat[i][j], ySpan);
      Ymat[j][i] = C.sub(Ymat[j][i], ySpan);
    });
    groundedIds.forEach(id => {
      const p = poleById(design, id);
      const i = nodeIdx[id];
      Ymat[i][i] = C.add(Ymat[i][i], { re: 1 / Number(p.groundOhms), im: 0 });
    });
    Ymat[txNodeIdx][txNodeIdx] = C.add(Ymat[txNodeIdx][txNodeIdx], { re: 1 / RgTx, im: 0 });
  }
  // (The transformer bus's own current injection into this matrix — not zero, since its ideal
  // per-phase sources are eliminated into this reduced system — is set alongside the pole
  // injections each iteration below, not here, since it depends on Icum which isn't known yet.)
  // A node's neutral voltage relative to true earth (only meaningful once groundedIds is
  // non-empty — see above). VnTx is the transformer bus's own entry in the same solve.
  let Vn = {}; order.forEach(id => Vn[id] = C.zero());
  let VnTx = C.zero();

  // Damping factor starts fairly aggressive (fast convergence on the easy, common case) and
  // backs off automatically whenever the mismatch stops improving — a heavily unbalanced load
  // over a long/thin span is a genuinely stiffer fixed point to settle into (the corrected
  // neutral-return sign below makes a loaded phase's own loop impedance larger, which is more
  // physically accurate but also a harder equation to iterate on), so a single fixed alpha that
  // works for the easy case can oscillate on the hard one; backing off keeps both working without
  // penalizing the common case with needlessly slow convergence.
  const MAX_ITER = 150, TOL = 1e-4;
  let alpha = 0.65, prevMaxDelta = Infinity;
  let converged = false, lastDelta = Infinity, iterUsed = 0;
  for (let iter = 0; iter < MAX_ITER; iter++) {
    iterUsed = iter + 1;
    const Iself = {};
    order.forEach(id => {
      const { loadS, otherS } = netS(design, id, year, hour, loadMult, solarMult, extraPV, extraBess); const Ip = {};
      PHASES.forEach(ph => {
        const zip = zipMultiplier(design, C.abs(V[id][ph]));
        const S = C.add(C.mulS(loadS[ph], zip), otherS[ph]);
        Ip[ph] = C.conj(C.div(S, V[id][ph]));
      });
      Iself[id] = Ip;
    });
    Icum = {};
    const rev = [...order].reverse();
    rev.forEach(id => {
      let tot = { A: C.zero(), B: C.zero(), C: C.zero() };
      PHASES.forEach(ph => tot[ph] = C.add(tot[ph], C.mulS(Iself[id][ph], 1000)));
      kidsOf[id].forEach(k => { PHASES.forEach(ph => tot[ph] = C.add(tot[ph], Icum[k][ph])); });
      Icum[id] = tot;
    });

    if (groundedIds.length) {
      // Each pole injects its own net unbalance current into the neutral network — children's
      // contributions are handled by the network solve itself (via the series admittances),
      // not by pre-aggregating like Icum does for the phase currents. Positive sum, matching the
      // `In` convention above: KCL says the neutral network receives exactly Ia+Ib+Ic at this
      // node, not its negation.
      const J = order.map(id => {
        const s = Iself[id];
        return C.mulS(C.add(C.add(s.A, s.B), s.C), 1000);
      });
      // The transformer bus is *not* injection-free: eliminating the ideal per-phase EMF sources
      // (Sa/Sb/Sc, each tied to this node by a fixed offset) into a reduced system leaves this
      // node carrying the exact negative of everything injected everywhere else in this subtree
      // — physically, every bit of unbalance current the network injects ultimately originates
      // from and returns to the transformer's own windings. Verified against an independent
      // supernode-KCL derivation (not just asserted) before relying on it.
      let txInject = C.zero();
      feederRootIds.forEach(id => { PHASES.forEach(ph => { txInject = C.add(txInject, Icum[id][ph]); }); });
      J.push(C.mulS(txInject, -1));
      // Damped the same way Vbus is below — Vn/VnTx are reference points everything else
      // cascades from, just like Vbus, so leaving them undamped (unlike literally everything
      // else in this loop) let a low-impedance ground path feed back into itself too strongly
      // from one iteration to the next and oscillate instead of settling.
      const sol = solveComplexLinearSystem(Ymat, J);
      order.forEach((id, i) => { Vn[id] = C.add(Vn[id], C.mulS(C.sub(sol[i], Vn[id]), alpha)); });
      VnTx = C.add(VnTx, C.mulS(C.sub(sol[txNodeIdx], VnTx), alpha));
    }

    Itot = { A: C.zero(), B: C.zero(), C: C.zero() };
    feederRootIds.forEach(id => PHASES.forEach(ph => Itot[ph] = C.add(Itot[ph], Icum[id][ph])));
    PHASES.forEach(ph => {
      const rawBus = C.sub(V0ph[ph], C.mul(txZc, Itot[ph]));
      Vbus[ph] = C.add(Vbus[ph], C.mulS(C.sub(rawBus, Vbus[ph]), alpha));
    });

    // Grounded case only: a separate phase-conductor-only cascade (Zph drops alone, no Vn
    // anywhere in it) — Vn[id] from the matrix solve is already the *absolute* neutral offset
    // from the root for that node, so it must be combined with this exactly once per node, not
    // subtracted at every step of a chain that already carries the parent's own Vn (which would
    // double/triple-count it down the tree).
    let VphaseOnly = null;
    if (groundedIds.length) {
      VphaseOnly = {};
      order.forEach(id => {
        const parent = parentOf[id];
        const Vp = parent === tx.id ? Vbus : VphaseOnly[parent];
        const z = spanZ[id];
        const vph = {};
        PHASES.forEach(ph => { vph[ph] = C.sub(Vp[ph], C.mul(z.Zph, Icum[id][ph])); });
        VphaseOnly[id] = vph;
      });
    }

    let maxDelta = 0;
    const newV = {};
    order.forEach(id => {
      const parent = parentOf[id];
      const Vp = parent === tx.id ? Vbus : newV[parent];
      const z = spanZ[id];
      const vph = {};
      // Ungrounded: identical to the original formula (In·Zn added to every phase equally).
      // Grounded: this node's phase-only potential minus how far its neutral has drifted from
      // the transformer's own solved neutral offset (both measured relative to true earth, so
      // the transformer's own offset must be subtracted back out to land on the same reference
      // VphaseOnly is built from — otherwise the transformer's ground resistance would leak into
      // every phase-to-neutral reading even when it's irrelevant, see the comment above).
      // In = the neutral conductor's return current = Ia+Ib+Ic (KCL: whatever current the phase
      // conductors carried out of the source must return via the neutral, same sign — this is
      // NOT negated; the neutral's own impedance drop ADDS to a loaded phase's drop, exactly like
      // any other series impedance in the same current loop, per basic KVL).
      const In = groundedIds.length ? null : C.add(C.add(Icum[id].A, Icum[id].B), Icum[id].C);
      PHASES.forEach(ph => {
        const raw = groundedIds.length
          ? C.sub(VphaseOnly[id][ph], C.sub(Vn[id], VnTx))
          : C.sub(Vp[ph], C.add(C.mul(z.Zph, Icum[id][ph]), C.mul(z.Zn, In)));
        vph[ph] = C.add(V[id][ph], C.mulS(C.sub(raw, V[id][ph]), alpha));
        const d = C.abs(C.sub(vph[ph], V[id][ph]));
        if (d > maxDelta) maxDelta = d;
      });
      newV[id] = vph;
    });
    order.forEach(id => V[id] = newV[id]);
    lastDelta = maxDelta;
    if (maxDelta < TOL) { converged = true; break; }
    // Not improving (or actively getting worse) — ease off the damping for subsequent
    // iterations rather than let it oscillate indefinitely until MAX_ITER is exhausted.
    if (maxDelta >= prevMaxDelta * 0.999) alpha = Math.max(alpha * 0.6, 0.02);
    prevMaxDelta = maxDelta;
  }

  // Actual current through a span's neutral conductor: with no grounding this is just the
  // aggregate sum of phase currents (KCL — see the `In` comment above) as before; with grounding,
  // some of that current may have exited to earth upstream or at this pole itself, so it's
  // derived from the solved neutral voltages either side of the span instead.
  const spanNeutralCurrent = (id) => {
    if (!groundedIds.length) return C.add(C.add(Icum[id].A, Icum[id].B), Icum[id].C);
    const parent = parentOf[id];
    const VnParent = parent === tx.id ? VnTx : Vn[parent];
    return C.div(C.sub(VnParent, Vn[id]), spanZ[id].Zn);
  };

  const poleResults = order.map(id => {
    const p = poleById(design, id);
    const volt = {}; PHASES.forEach(ph => { volt[ph] = C.abs(V[id][ph]); });
    const cur = {}; PHASES.forEach(ph => cur[ph] = C.abs(Icum[id][ph]));
    const In = C.abs(spanNeutralCurrent(id));
    const rating = CONDUCTORS[p.cond].I;
    let Sspan = C.zero();
    PHASES.forEach(ph => Sspan = C.add(Sspan, C.mul(V[id][ph], C.conj(Icum[id][ph]))));
    const flowKW = Sspan.re / 1000, flowKVAR = Sspan.im / 1000;
    return {
      id, feeder: p.feeder, parent: p.parent, cond: p.cond, spanM: p.spanM,
      volt, cur, In, rating, condPct: { A: cur.A / rating * 100, B: cur.B / rating * 100, C: cur.C / rating * 100 },
      flowKW, flowKVAR
    };
  });

  let totalLossW = 0;
  const lossByPole = {};
  order.forEach(id => {
    const p = poleById(design, id); const km = p.spanM / 1000;
    const Rph = CONDUCTORS[p.cond].R * km, Rn = condRn(p.cond) * km;
    let l = 0;
    PHASES.forEach(ph => l += Math.pow(C.abs(Icum[id][ph]), 2) * Rph);
    const In = C.abs(spanNeutralCurrent(id));
    l += In * In * Rn;
    lossByPole[id] = l; totalLossW += l;
  });
  // Real dissipation in each grounded pole's earth electrode — a genuine loss component that
  // doesn't exist when no pole is grounded. The transformer's own star-point electrode carries
  // *zero* current (hence zero loss) whenever it's the sole ground point in the subtree: the
  // unbalance current returning via the neutral has nowhere else to go but back into the
  // transformer's own windings (that's what "solidly grounded Y-secondary" means electrically),
  // so VnTx stays 0 in that case — confirmed via an independent supernode-KCL derivation, not
  // just assumed. It only carries current once a pole's earth electrode gives current a second,
  // competing path to the same earth reference, which is exactly the groundedIds.length branch.
  let groundLossW = Math.pow(C.abs(VnTx), 2) / RgTx;
  const groundLossByPole = {};
  groundedIds.forEach(id => {
    const p = poleById(design, id);
    const Rg = Number(p.groundOhms);
    const Igr = C.abs(C.div(Vn[id], { re: Rg, im: 0 }));
    const l = Igr * Igr * Rg;
    groundLossByPole[id] = l; groundLossW += l;
  });

  let Stx = C.zero();
  feederRootIds.forEach(id => { PHASES.forEach(ph => { Stx = C.add(Stx, C.mul(Vbus[ph], C.conj(Icum[id][ph]))); }); });
  const txKVA = C.abs(Stx) / 1000;
  const txPct = txKVA / TRANSFORMERS[tx.txRating].kVA * 100;

  let txLossW = 0;
  PHASES.forEach(ph => txLossW += Math.pow(C.abs(Itot[ph]), 2) * txZ.r);
  const txNoLoadW = (design.txNoLoadW && design.txNoLoadW[tx.txRating] != null)
    ? Number(design.txNoLoadW[tx.txRating])
    : TRANSFORMERS[tx.txRating].noLoadW;
  const busVoltPct = {}; PHASES.forEach(ph => busVoltPct[ph] = C.abs(Vbus[ph]));

  const netKW = Stx.re / 1000, netKVAR = Stx.im / 1000;
  const flowDirection = netKW >= 0 ? 'import' : 'export';

  return {
    converged, iterUsed, lastDelta, poleResults, totalLossW, lossByPole, groundLossW, groundLossByPole,
    summary: { id: tx.id, name: tx.name, txKVA, txPct, flowDirection, netKW, netKVAR, busVoltPct, txZ, txLossW, txNoLoadW, V0 }
  };
}

// Runs one full load-flow snapshot across every transformer in the design.
// options: {year, hour, loadMult, solarMult, extraPV, extraBess}
export function runSnapshot(design, opts) {
  const { year, hour, loadMult = 1, solarMult = 1, extraPV = [], extraBess = [] } = opts;
  const solved = design.transformers.map(tx => solveTxSubtree(design, tx, { year, hour, loadMult, solarMult, extraPV, extraBess }));

  const poleResults = solved.flatMap(s => s.poleResults);
  const lossByPole = Object.assign({}, ...solved.map(s => s.lossByPole));
  const totalLossW = solved.reduce((sum, s) => sum + s.totalLossW, 0);
  const groundLossByPole = Object.assign({}, ...solved.map(s => s.groundLossByPole));
  const groundLossW = solved.reduce((sum, s) => sum + s.groundLossW, 0);
  const converged = solved.every(s => s.converged);
  const iterUsed = Math.max(...solved.map(s => s.iterUsed));
  const lastDelta = Math.max(...solved.map(s => s.lastDelta));
  const transformers = solved.map(s => s.summary);

  const vLimLow = design.vnom * (1 - design.vdev / 100), vLimHigh = design.vnom * (1 + design.vdev / 100);
  let violations = [];
  poleResults.forEach(pr => {
    PHASES.forEach(ph => {
      if (pr.volt[ph] < vLimLow) violations.push({ pole: pr.id, phase: ph, type: 'undervoltage', value: pr.volt[ph] });
      if (pr.volt[ph] > vLimHigh) violations.push({ pole: pr.id, phase: ph, type: 'overvoltage', value: pr.volt[ph] });
    });
    PHASES.forEach(ph => { if (pr.condPct[ph] > 100) violations.push({ pole: pr.id, phase: ph, type: 'thermal', value: pr.condPct[ph] }); });
  });
  transformers.forEach(t => {
    if (t.txPct > 100 && t.flowDirection === 'import') violations.push({ pole: t.id, phase: '-', type: 'transformer overload', value: t.txPct });
  });

  return {
    converged, iterUsed, lastDelta, poleResults, totalLossW, lossByPole, groundLossW, groundLossByPole, transformers,
    violations, vLimLow, vLimHigh, year, hour, loadMult, solarMult
  };
}

/* ============================================================
   SOLAR HOSTING CAPACITY
============================================================ */
const HOSTING_TEST_HOURS = [9, 10, 11, 12, 13, 14, 15];

// Binary-searches the largest single-phase PV (kVA) addable at pole/phase — on top of any
// `committed` additions already locked in elsewhere — before a voltage or thermal limit is
// hit across the solar shoulder hours. Iteration count scales with the search ceiling so
// resolution stays fine (~0.02 kVA) whether `hi` is a small policy cap or a large uncapped one.
function findMaxPV(design, pole, phase, hi, committed) {
  let lo = 0, best = 0;
  const iters = Math.max(7, Math.ceil(Math.log2(Math.max(hi, 0.01) / 0.02)) + 1);
  for (let iter = 0; iter < iters; iter++) {
    const mid = (lo + hi) / 2;
    let feasible = true;
    for (const h of HOSTING_TEST_HOURS) {
      const res = runSnapshot(design, { year: 0, hour: h, loadMult: 1, solarMult: 1, extraPV: [...committed, { pole, phase, kva: mid }] });
      if (res.violations.length > 0) { feasible = false; break; }
    }
    if (feasible) { best = mid; lo = mid; } else { hi = mid; }
  }
  return Math.round(best * 20) / 20;
}

export function computeHostingCapacity(design, capOverride) {
  const results = [];
  const cap = capOverride != null ? capOverride : design.maxpv;
  design.poles.forEach(p => {
    ['A', 'B', 'C'].forEach(phase => {
      const best = findMaxPV(design, p.id, phase, cap, []);
      if (best > 0.05) results.push({ pole: p.id, phase, kva: best });
    });
  });
  results.sort((a, b) => b.kva - a.kva);
  return results;
}

// Generous ceiling used only to discover each location's true, policy-unconstrained
// voltage/thermal limit for computeSystemHostingCapacity — comfortably above anything a real
// single-phase LV connection could reach, so the search always bottoms out on an actual
// network limit (voltage rise or conductor thermal rating) rather than this number.
const UNCAPPED_CEILING_KVA = 2000;

// System-wide hosting capacity: processes candidate pole/phase locations in the same
// best-first order as computeHostingCapacity, but — like a real interconnection queue —
// tests each candidate's headroom with every previously accepted addition already locked
// in place. This captures the interaction between simultaneous PV additions (compounding
// voltage rise, shared thermal headroom) that the independent per-location scan ignores,
// so the resulting total is the true maximum that can be added to the design all at once,
// and per-location amounts often come out lower than the independent estimate. The Setup
// page's per-connection PV cap is deliberately ignored here — this reports the physical
// (voltage/thermal) ceiling, not a policy-limited one.
export function computeSystemHostingCapacity(design) {
  const independent = computeHostingCapacity(design, UNCAPPED_CEILING_KVA);
  const committed = [];
  const results = independent.map(cand => {
    const best = findMaxPV(design, cand.pole, cand.phase, cand.kva, committed);
    if (best > 0.05) committed.push({ pole: cand.pole, phase: cand.phase, kva: best });
    return { pole: cand.pole, phase: cand.phase, independentKva: cand.kva, achievableKva: best };
  });
  const totalKva = results.reduce((s, r) => s + r.achievableKva, 0);
  return { results, totalKva };
}

/* ============================================================
   BESS HOSTING CAPACITY
============================================================ */
// BESS stresses the network in both directions — charging pulls voltage down and loads the
// transformer like any load, discharging pushes voltage up and reverse-flows it like PV — so
// candidates are tested across the union of both configured windows rather than one fixed
// shoulder-hour list.
function bessTestHours(design) {
  return [...rangeHours(design.bessChargeStartHour, design.bessChargeEndHour), ...rangeHours(design.bessDischargeStartHour, design.bessDischargeEndHour)];
}

// At any hour inside the (global) charge window, every BESS unit in the network — committed,
// candidate, and real — is charging, so the only way voltage moves is down: charging can create
// or worsen undervoltage/thermal/transformer-import loading, but it physically cannot cause
// overvoltage, only relieve it (that's the whole point of scheduling charging over the midday
// solar window — it's meant to soak up the overvoltage high solar generation causes). Symmetrically,
// every BESS unit is discharging inside the discharge window, so it can create or worsen
// overvoltage/thermal, but cannot cause undervoltage — it can only relieve it (that's the point of
// scheduling discharge over the evening peak). So a hosting candidate should never be rejected for
// an overvoltage seen at a charge hour, or an undervoltage seen at a discharge hour — that
// violation is coming from solar/load that exists with or without this BESS, and the BESS is
// helping (or at worst is neutral to) it, not causing it.
function bessRelevantViolations(design, hour, violations) {
  const mult = bessMultiplierAt(design, hour);
  if (mult < 0) return violations.filter(v => v.type !== 'overvoltage');
  if (mult > 0) return violations.filter(v => v.type !== 'undervoltage');
  return violations;
}

// Binary-searches the largest single-phase BESS (kVA) addable at pole/phase — on top of any
// `committed` additions already locked in elsewhere — before a voltage or thermal limit the BESS
// could actually cause is hit, across the charge or discharge windows (a candidate must be clean
// in the direction it can affect at each hour — see bessRelevantViolations).
function findMaxBess(design, pole, phase, hi, committed) {
  let lo = 0, best = 0;
  const testHours = bessTestHours(design);
  const iters = Math.max(7, Math.ceil(Math.log2(Math.max(hi, 0.01) / 0.02)) + 1);
  for (let iter = 0; iter < iters; iter++) {
    const mid = (lo + hi) / 2;
    let feasible = true;
    for (const h of testHours) {
      const res = runSnapshot(design, { year: 0, hour: h, loadMult: 1, solarMult: 1, extraBess: [...committed, { pole, phase, kva: mid }] });
      if (bessRelevantViolations(design, h, res.violations).length > 0) { feasible = false; break; }
    }
    if (feasible) { best = mid; lo = mid; } else { hi = mid; }
  }
  return Math.round(best * 20) / 20;
}

export function computeBessHostingCapacity(design, capOverride) {
  const results = [];
  const cap = capOverride != null ? capOverride : design.maxbess;
  design.poles.forEach(p => {
    ['A', 'B', 'C'].forEach(phase => {
      const best = findMaxBess(design, p.id, phase, cap, []);
      if (best > 0.05) results.push({ pole: p.id, phase, kva: best });
    });
  });
  results.sort((a, b) => b.kva - a.kva);
  return results;
}

// Average reduction in total system loss (line + transformer) a small 1 kVA BESS addition at
// pole/phase produces, across the charge+discharge test hours, on top of `committed` — positive
// means adding BESS here reduces network loss (e.g. peak-shaving a heavily loaded feeder tail).
function lossImpactScore(design, pole, phase, committed) {
  const testHours = bessTestHours(design);
  const probeKva = 1;
  let deltaSum = 0;
  testHours.forEach(h => {
    const base = runSnapshot(design, { year: 0, hour: h, loadMult: 1, solarMult: 1, extraBess: committed });
    const withProbe = runSnapshot(design, { year: 0, hour: h, loadMult: 1, solarMult: 1, extraBess: [...committed, { pole, phase, kva: probeKva }] });
    deltaSum += systemLossW(base).totalLossW - systemLossW(withProbe).totalLossW;
  });
  return deltaSum / testHours.length;
}

// System-wide BESS hosting capacity: unlike the PV queue (which fills by raw headroom first),
// this queue is ordered by loss-reduction impact — locations that cut network loss the most are
// committed first — then walked exactly like the PV queue (each candidate tested with every
// higher-priority addition already locked in) to get the true simultaneous maximum. The Setup
// page's per-connection BESS cap is ignored here — this reports the physical ceiling.
export function computeSystemBessHostingCapacity(design) {
  const independent = computeBessHostingCapacity(design, UNCAPPED_CEILING_KVA);
  const scored = independent.map(cand => ({ ...cand, lossScore: lossImpactScore(design, cand.pole, cand.phase, []) }));
  scored.sort((a, b) => b.lossScore - a.lossScore || b.kva - a.kva);

  const committed = [];
  const results = scored.map(cand => {
    const best = findMaxBess(design, cand.pole, cand.phase, cand.kva, committed);
    if (best > 0.05) committed.push({ pole: cand.pole, phase: cand.phase, kva: best });
    return { pole: cand.pole, phase: cand.phase, independentKva: cand.kva, lossScore: cand.lossScore, achievableKva: best };
  });
  const totalKva = results.reduce((s, r) => s + r.achievableKva, 0);

  const baselineLossKwh = dailyEnergyLossKwh(design, []);
  const withBessLossKwh = dailyEnergyLossKwh(design, committed);
  return {
    results, totalKva, baselineLossKwh, withBessLossKwh,
    lossReductionKwh: baselineLossKwh.totalKwh - withBessLossKwh.totalKwh
  };
}

/* ============================================================
   24-HOUR PROFILE
============================================================ */
export function runDailyScan(design, year, opts = {}) {
  const { loadMult = 1, solarMult = 1, extraBess = [] } = opts;
  return [...Array(24).keys()].map(h => runSnapshot(design, { year, hour: h, loadMult, solarMult, extraBess }));
}

// Splits a runSnapshot result's losses into line vs. transformer (copper + no-load), and their
// sum — replaces the res.transformers.reduce(...) expression that used to be duplicated across
// report.js and ReportsPage.jsx.
export function systemLossW(res) {
  const txLossW = res.transformers.reduce((s, t) => s + t.txLossW + t.txNoLoadW, 0);
  const groundLossW = res.groundLossW || 0;
  return { lineLossW: res.totalLossW, txLossW, groundLossW, totalLossW: res.totalLossW + txLossW + groundLossW };
}

// Sums system loss (line + transformer) across a fresh 24-hour scan at year 0, nominal (1x)
// load/solar, with `extraBess` candidate BESS additions applied at every hour — used by the
// report's energy-loss section and to report the loss impact of a BESS hosting allocation.
export function dailyEnergyLossKwh(design, extraBess = []) {
  const daily = runDailyScan(design, 0, { loadMult: 1, solarMult: 1, extraBess });
  let lineKwh = 0, txKwh = 0, groundKwh = 0;
  daily.forEach(res => {
    const { lineLossW, txLossW, groundLossW } = systemLossW(res);
    lineKwh += lineLossW / 1000; txKwh += txLossW / 1000; groundKwh += groundLossW / 1000;
  });
  return { lineKwh, txKwh, groundKwh, totalKwh: lineKwh + txKwh + groundKwh };
}

/* ============================================================
   FEEDER SPLIT ADVISOR
============================================================ */
// Buckets an arbitrary set of snapshot results' violations by type and totals their loss — shared
// by the baseline (current design) and every candidate the split search evaluates, so both are
// scored on exactly the same basis. Not tied to a 24-hour scan specifically — `lossKwh` is really
// "loss over however many hours were scanned"; for a single-hour scan (solar/night peak-only
// testing — see DAILY_HOURS/scanAndSummarize below) that's numerically the same as the
// instantaneous kW figure, just labelled differently by the page.
//
// Also folds in a per-transformer breakdown (`transformers`) — worst-case loading and voltage
// band, plus total loss, for *every* transformer in the design over the same scanned hours — not
// used to rank candidates (voltage violations, then network loss, still decide that), but reported
// alongside so the whole network's picture (not just the new transformer, and not just whether a
// statutory line was crossed) is visible before choosing one. Computed in this same pass over
// `snapshots` rather than a second scan, since every figure it needs is already produced by
// runSnapshot regardless.
export function summarizeScan(snapshots) {
  let voltageViolationCount = 0, thermalViolationCount = 0, txOverloadViolationCount = 0, lossKwh = 0;
  const txStats = {};
  snapshots.forEach(res => {
    res.violations.forEach(v => {
      if (v.type === 'undervoltage' || v.type === 'overvoltage') voltageViolationCount++;
      else if (v.type === 'thermal') thermalViolationCount++;
      else if (v.type === 'transformer overload') txOverloadViolationCount++;
    });
    lossKwh += systemLossW(res).totalLossW / 1000;
    res.transformers.forEach(t => {
      let s = txStats[t.id];
      if (!s) s = txStats[t.id] = { id: t.id, name: t.name, peakPct: 0, peakKva: 0, minVPct: Infinity, maxVPct: -Infinity, lossKwh: 0 };
      if (t.txPct > s.peakPct) s.peakPct = t.txPct;
      if (t.txKVA > s.peakKva) s.peakKva = t.txKVA;
      PHASES.forEach(ph => { const v = t.busVoltPct[ph]; if (v < s.minVPct) s.minVPct = v; if (v > s.maxVPct) s.maxVPct = v; });
      s.lossKwh += (t.txLossW + t.txNoLoadW) / 1000;
    });
  });
  // Approximate secondary-side line current from peak kVA (balanced-equivalent, 415V line-line) —
  // the solver doesn't otherwise surface a single scalar "transformer current", only per-pole
  // per-phase currents, so this is the same kind of estimate a planner would do by hand.
  const transformers = Object.values(txStats).map(s => ({ ...s, peakCurrentA: s.peakKva * 1000 / (Math.sqrt(3) * 415) }));
  const converged = snapshots.every(res => res.converged);
  return { voltageViolationCount, thermalViolationCount, txOverloadViolationCount, lossKwh, converged, transformers };
}

// The default "test conditions" for a split search — every hour of the day, nominal solar. The
// two alternatives (solar-peak-only, night-peak-only) reuse the exact same representative hours
// as DiagramPage's own "Quick snapshot" presets, for consistency across the app.
export const DAILY_HOURS = [...Array(24).keys()];

// Runs one snapshot per hour in `hours` (year 0, nominal load, the given solar multiplier) and
// summarizes it — the one shared code path every split-search scorer below uses, so "test over
// the full day" vs "test at solar peak only" vs "test at night peak only" is just a different
// `hours`/`solarMult` pair, not different logic.
export function scanAndSummarize(design, hours = DAILY_HOURS, solarMult = 1) {
  return summarizeScan(hours.map(h => runSnapshot(design, { year: 0, hour: h, loadMult: 1, solarMult })));
}

// Tree-path distance (sum of spanM) between any two poles fed from the same transformer, or
// `null` if they're on different transformers (there's no path — this is a forest of disjoint
// trees, not a meshed network). Walks up from `poleIdX` recording each ancestor's distance from
// X (stopping once the transformer root itself is recorded), then walks up from `poleIdY`
// accumulating distance until it hits an id already in that map — the lowest common ancestor,
// which may be the shared transformer itself. This is what lets a connector cable's length be
// *derived* from a common open point's real position instead of guessed.
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

// Applies a reparent plan — `reparents` is [{poleId, parent, spanM, cond, feeder}, ...], one
// entry per pole that needs a new parent (see siteReparentPlan/resolveSiteReparentPlan below for
// how a plan is built; a plain single-feeder split has one entry, a dual-feeder split has at
// least two, and a *reversed* attachment — see resolveSiteReparentPlan — has one entry per pole
// along the reversed segment). `parent` is either an explicit existing pole id (a reversed
// segment's internal edges always point at a real pole) or `null`/`undefined`, meaning "attach to
// the new transformer being added here" — resolved to `newTx.id` at build time rather than baked
// into the plan when it was computed, so a plan built during a search (with one newTx id) can
// still be re-applied later at Apply time (with a possibly different, freshly-allocated id)
// without going stale. Reused by every search below (to score each candidate) and by the page's
// preview/Apply actions (to commit the chosen one), so none of them can ever drift apart. Never
// mutates `design` or any pole object in place — every pole *not* named in the plan keeps
// referencing whatever parent it already had, so whole subtrees (and any side-branches off a
// reversed segment) follow their own parent automatically, without needing to be listed.
export function buildSplitCandidate(design, newTx, reparents) {
  return {
    ...design,
    transformers: [...design.transformers, newTx],
    poles: design.poles.map(p => {
      const r = reparents.find(r => r.poleId === p.id);
      return r ? { ...p, parent: r.parent ?? newTx.id, spanM: Number(r.spanM) || 0, cond: r.cond, feeder: r.feeder } : p;
    })
  };
}

// All poles belonging to the same feeder tree as `anchorPoleId` — its own root pole(s) under its
// own specific transformer, then everything downstream. Deliberately scoped by the *exact*
// transformer id (`p.parent === tx`), not just a feeder-name string match against the whole
// design — two different transformers can easily end up with identically-named feeders (e.g. both
// habitually called "F1"), and matching by name alone would wrongly combine both into one
// candidate pool. Every split search below (single- and dual-feeder alike) is scoped this way —
// by a specific anchor pole, never a bare name — so a feeder name can be reused freely across
// transformers (as buildSplitCandidate's new-transformer "F1"/"F2" naming above now does) without
// ever risking two different transformers' trees being combined into one candidate pool.
function feederPolesAnchoredAt(design, anchorPoleId) {
  const tx = transformerOfPole(design, anchorPoleId);
  const feederName = poleById(design, anchorPoleId).feeder;
  const roots = design.poles.filter(p => p.parent === tx && p.feeder === feederName).map(p => p.id);
  return bfsOrderFrom(design, roots);
}

// One entry per distinct (transformer, feeder name) tree in the design — the root pole id
// unambiguously identifies it, unlike a bare feeder name which two different transformers could
// share. This is what the single-feeder page's "feeder to split" picker is built from, instead of
// feederRoots(design)'s bare names, so picking a feeder can never accidentally resolve to a
// different transformer's identically-named one.
export function feederTrees(design) {
  const seen = new Set();
  const trees = [];
  design.poles.filter(p => isTransformerId(design, p.parent)).forEach(p => {
    const key = p.parent + '|' + p.feeder;
    if (seen.has(key)) return;
    seen.add(key);
    trees.push({ rootPoleId: p.id, feederName: p.feeder, txId: p.parent });
  });
  return trees;
}

// The feeder split point (where the *electrical* cut happens) and the new transformer's physical
// *site* are two independent decisions — the site doesn't have to be the split point, and it
// doesn't have to be upstream of it either. When the site is a fixed anchor pole that turns out to
// be *downstream* of the chosen split point (e.g. siting the transformer right at a common open
// point, while the best split point the search finds is a pole or two further back up the same
// feeder), simply "reparent the split point, connector length = distance to the site" is wrong:
// the site pole would still be dangling off the split point through its own original span, so the
// transformer would end up that span's length away from the site it's supposed to be sitting on,
// not on top of it. What's actually needed is to walk the segment between split point and site and
// *reverse* it — the site pole becomes the new local root (0m from the transformer, since it's
// physically right there), and every pole between it and the split point gets its parent pointer
// flipped (keeping its real original span/conductor — it's the same physical cable, just now
// carrying power the other way), leaving the split point itself — and anything above it, or any
// side-branch off the reversed segment that isn't on the direct path — exactly as it was, still
// fed from the original transformer. This is what resolveSiteReparentPlan below detects and
// builds; it degrades to the simple single-entry case whenever the site is upstream of (or
// unrelated to, e.g. on a different branch or transformer entirely) the split point.
function resolveSiteReparentPlan(design, splitPoleId, anchorPoleId, cond, feederName) {
  if (anchorPoleId === splitPoleId) {
    return [{ poleId: splitPoleId, parent: null, spanM: 0, cond, feeder: feederName }];
  }
  // Walk up from the anchor; if we reach splitPoleId, the anchor is downstream of it (reversal
  // needed) and `chain` is [anchor, ..., splitPoleId]. If we run out of tree without matching, the
  // anchor is upstream of (or unrelated to) the split point — the ordinary, already-correct case.
  const chain = [anchorPoleId];
  let cur = anchorPoleId, reachedSplit = false;
  while (!isTransformerId(design, cur)) {
    cur = poleById(design, cur).parent;
    chain.push(cur);
    if (cur === splitPoleId) { reachedSplit = true; break; }
  }
  if (!reachedSplit) {
    return [{ poleId: splitPoleId, parent: null, spanM: polePathDistanceM(design, anchorPoleId, splitPoleId) || 0, cond, feeder: feederName }];
  }
  // Reparent every pole from just above the anchor all the way up to and *including* the split
  // point itself — "cut at the split point" means the split point and everything from it onward
  // relieves to the new transformer, same as the forward case (where the split point's whole
  // original subtree moves); here that just happens via the reversed path instead.
  const plan = [{ poleId: chain[0], parent: null, spanM: 0, cond, feeder: feederName }];
  for (let j = 1; j < chain.length; j++) {
    const original = poleById(design, chain[j - 1]); // the real cable that used to run chain[j-1] -> chain[j]
    plan.push({ poleId: chain[j], parent: chain[j - 1], spanM: original.spanM, cond: original.cond, feeder: feederName });
  }
  return plan;
}

// Resolves the full reparent plan for candidate split point `poleId` given a site spec:
//   - {mode:'atSplit'}            — the transformer sits directly on whichever pole gets cut;
//                                    always 0m, regardless of which candidate this is.
//   - {mode:'anchor', anchor}     — the transformer's site is a specific, fixed pole — see
//                                    resolveSiteReparentPlan above for why this can take more than
//                                    one entry. Used both for "at a specific pole" and "at a
//                                    common open point" (the anchor is just resolved differently
//                                    by the caller — the pole picked directly, or one side of an
//                                    open point).
//   - {mode:'manual', spanM}      — a flat, user-guessed length, unrelated to any real pole.
// The anchor must be supplied by the caller rather than re-derived here from e.g. an open point
// id — it's the caller that actually knows which side corresponds to which feeder/candidate set,
// so there's nothing left to guess or get wrong here.
function siteReparentPlan(design, poleId, siteSpec, feederName) {
  if (siteSpec.mode === 'atSplit') return [{ poleId, parent: null, spanM: 0, cond: siteSpec.cond, feeder: feederName }];
  if (siteSpec.mode === 'anchor') return resolveSiteReparentPlan(design, poleId, siteSpec.anchor, siteSpec.cond, feederName);
  return [{ poleId, parent: null, spanM: Number(siteSpec.spanM) || 0, cond: siteSpec.cond, feeder: feederName }];
}

// The "connector length" shown to the user for a candidate — the real distance between the site
// and the split point, regardless of which direction the resulting topology actually runs (a
// path's length doesn't depend on which way it's walked). For a reversed attachment this is
// mostly *existing* conductor being reused, not new cable — see resolveSiteReparentPlan.
function siteConnectorDisplayM(design, poleId, siteSpec) {
  if (siteSpec.mode === 'atSplit') return 0;
  if (siteSpec.mode === 'anchor') return polePathDistanceM(design, siteSpec.anchor, poleId) || 0;
  return Number(siteSpec.spanM) || 0;
}

function makeTx(id, txSpec) {
  return {
    id, name: txSpec.name || id, txRating: txSpec.txRating, tap: txSpec.tap,
    hvActual: txSpec.hvActual, txXR: txSpec.txXR, txGroundOhms: txSpec.txGroundOhms
  };
}

// Exactly scores one candidate cut pole for a single-feeder split against new transformer `newTx`
// (an id already allocated by the caller, so repeated calls in a loop agree on it) — one scan over
// `hours` (default: the full day; pass a single representative hour, with a matching `solarMult`,
// to test solar-peak or night-peak conditions only instead). Exported (alongside the batch
// convenience wrapper below) so a caller scanning a long feeder can chunk the loop itself
// (yielding between calls) instead of blocking the main thread for the whole search, the same way
// scoreDualFeederCandidate is meant to be used.
export function scoreFeederSplitCandidate(design, poleId, newTx, siteSpec, hours = DAILY_HOURS, solarMult = 1) {
  const plan = siteReparentPlan(design, poleId, siteSpec, 'F1');
  const candidateDesign = buildSplitCandidate(design, newTx, plan);
  const metrics = scanAndSummarize(candidateDesign, hours, solarMult);
  // The plan's first entry is whichever pole actually attaches to the new transformer — the split
  // point itself in the ordinary case, or the site anchor when the attachment was reversed (see
  // resolveSiteReparentPlan) — so counting from there, in the *built* design, correctly reflects
  // the real moved subtree either way (side-branches included, since they simply keep pointing at
  // whichever plan pole they were already a child of).
  const movedPoleCount = bfsOrderFrom(candidateDesign, [plan[0].poleId]).length;
  const connectorM = siteConnectorDisplayM(design, poleId, siteSpec);
  return { poleId, connectorM, movedPoleCount, reparentPlan: plan, ...metrics };
}

// Scans every pole on the feeder tree anchored at `rootPoleId` (see feederPolesAnchoredAt — any
// pole on that specific (transformer, feeder-name) tree works, not necessarily its actual root)
// as a candidate cut point for a new transformer (spec `txSpec`), joined to each candidate by a
// connector cable per `siteSpec` (`{mode:'atSplit'}` — zero length, bolted directly to the cut
// pole; `{mode:'anchor', anchor, cond}` — length derived as the real path distance from a fixed
// pole, typically a specific pole picked directly or one side of a common open point;
// `{mode:'manual', spanM, cond}` — a flat guessed length), and ranks them primarily by how many
// statutory voltage violations remain over `hours` (default: the full day — see
// scoreFeederSplitCandidate for testing solar/night peak only instead; fewest violations first —
// eliminate if possible, minimize otherwise), tie-broken by total network loss over the same
// hours. Thermal and transformer-overload violations are scored too but don't affect the ranking —
// only voltage does. A synchronous convenience wrapper around scoreFeederSplitCandidate for the
// common case (a single feeder, short enough not to need chunking — see its page for the measured
// cost).
export function computeFeederSplitCandidates(design, rootPoleId, txSpec, siteSpec, hours = DAILY_HOURS, solarMult = 1) {
  const feederName = poleById(design, rootPoleId).feeder;
  const feederPoleIds = feederPolesAnchoredAt(design, rootPoleId);
  const newTxId = nextTransformerId(design);
  const newTx = makeTx(newTxId, txSpec);
  const baseline = scanAndSummarize(design, hours, solarMult);
  const candidates = feederPoleIds.map(poleId => scoreFeederSplitCandidate(design, poleId, newTx, siteSpec, hours, solarMult));
  candidates.sort((a, b) => a.voltageViolationCount - b.voltageViolationCount || a.lossKwh - b.lossKwh);
  return { feederName, newTxId, newTx, baseline, candidates };
}

// Relieving two feeders that meet at a common open point with one shared new transformer means
// testing every pole on feeder A paired with every pole on feeder B — but that full cross product
// needs a fresh 24-hour scan per pair, and is too slow to run synchronously for realistically
// long feeders (measured: ~40s for a 23×20-pole pairing, which would freeze the tab). So the dual
// search is staged, and every stage is left for the caller (the page) to run in a loop it can
// yield between, rather than done synchronously in one call here:
//
//   1. dualFeederSetup() resolves which two feeders meet at the open point and each side's full
//      candidate pole list (correctly scoped to its own transformer — see feederPolesAnchoredAt).
//   2. The caller scores every pole on each side independently with scoreFeederSplitCandidate
//      (one call per pole, yielding between), keeping only the top `k` from each side.
//   3. The caller then calls scoreDualFeederCandidate() — one exact, full-24h-scan joint
//      evaluation per pair — only across those shortlisted pairs (k², yielding between).
//
// This is an approximation only in *which* pairs get jointly tested in step 3; every candidate
// that is scored (at every stage) is scored exactly, never approximated.
export function dualFeederSetup(design, openPointId, txSpec, cond) {
  const op = design.openPoints.find(o => o.id === openPointId);
  const feederA = poleById(design, op.poleA).feeder, feederB = poleById(design, op.poleB).feeder;
  return {
    feederA, feederB,
    poleIdsA: feederPolesAnchoredAt(design, op.poleA),
    poleIdsB: feederPolesAnchoredAt(design, op.poleB),
    shortlistTx: makeTx(nextTransformerId(design), txSpec),
    siteSpecA: { mode: 'anchor', anchor: op.poleA, cond },
    siteSpecB: { mode: 'anchor', anchor: op.poleB, cond }
  };
}

// Exactly scores one (poleA, poleB) joint candidate for a dual-feeder split: cut both feeders
// that meet at `openPointId` and feed both tails from one shared new transformer `newTx` (an id
// already allocated by the caller, so repeated calls in a loop agree on it), each leg attached via
// resolveSiteReparentPlan — a plain connector when the open point's own pole is upstream of (or
// unrelated to) the chosen candidate, or a reversed segment when it's downstream (see that
// function's comment) — both using conductor `cond`. Passing the open point's own two poles as
// `poleA`/`poleB` scores placing the new transformer directly at the open point itself — both
// legs resolve to a single 0m entry automatically (anchor === candidate) — no separate "place at
// open point" logic needed. `hours`/`solarMult` — see scoreFeederSplitCandidate — test the full
// day by default, or pass a single representative hour for solar/night-peak-only testing.
export function scoreDualFeederCandidate(design, poleA, poleB, openPointId, newTx, cond, hours = DAILY_HOURS, solarMult = 1) {
  const op = design.openPoints.find(o => o.id === openPointId);
  const connectorAM = polePathDistanceM(design, op.poleA, poleA) || 0;
  const connectorBM = polePathDistanceM(design, op.poleB, poleB) || 0;
  const planA = resolveSiteReparentPlan(design, poleA, op.poleA, cond, 'F1');
  const planB = resolveSiteReparentPlan(design, poleB, op.poleB, cond, 'F2');
  const reparentPlan = [...planA, ...planB];
  const candidateDesign = buildSplitCandidate(design, newTx, reparentPlan);
  const metrics = scanAndSummarize(candidateDesign, hours, solarMult);
  return {
    poleA, connectorAM, movedPoleCountA: bfsOrderFrom(candidateDesign, [planA[0].poleId]).length,
    poleB, connectorBM, movedPoleCountB: bfsOrderFrom(candidateDesign, [planB[0].poleId]).length,
    reparentPlan,
    ...metrics
  };
}

/* ============================================================
   LOAD BALANCE ADVISOR
============================================================ */
// Every single-phase (phase !== 'ABC') connection fed from transformer `txId` — general/EV/EVCS/
// shop loads, rooftop PV, and BESS pooled together, each as its peak-equivalent kVA magnitude
// (ADMD-substituted for a null-kva load, same fallback the rest of the app already uses; the
// plain kva field for PV/BESS). Loads and PV/BESS are pooled deliberately: concentrating *either*
// heavy load or heavy generation on one phase stresses that phase at its own peak condition (night
// peak for load, midday for PV) — spreading either kind out by magnitude is the same practical
// fix, regardless of sign. 3-phase connections are skipped — already balanced by definition.
function balanceableConnections(design, txId) {
  const items = [];
  design.loads.forEach(l => {
    if (l.phase === 'ABC' || transformerOfPole(design, l.pole) !== txId) return;
    const kva = (l.kva == null || l.kva === '') ? design.admd : Number(l.kva);
    items.push({ kind: 'load', label: l.type, id: l.id, pole: l.pole, phase: l.phase, kva });
  });
  design.pv.forEach(p => {
    if (p.phase === 'ABC' || transformerOfPole(design, p.pole) !== txId) return;
    items.push({ kind: 'pv', label: 'PV', id: p.id, pole: p.pole, phase: p.phase, kva: Number(p.kva) });
  });
  design.bess.forEach(b => {
    if (b.phase === 'ABC' || transformerOfPole(design, b.pole) !== txId) return;
    items.push({ kind: 'bess', label: 'BESS', id: b.id, pole: b.pole, phase: b.phase, kva: Number(b.kva) });
  });
  return items;
}

// Greedy largest-first phase balancing for transformer `txId`: sort every balanceable connection
// by kVA descending, repeatedly assign the next one to whichever phase currently has the smallest
// running total. The standard fast heuristic for this kind of balanced-partition problem — exact
// optimal partitioning is NP-hard, but largest-first greedy reliably lands close at the scale of a
// real LV island's connection count. Returns `before`/`after` per-phase kVA totals and `changed`
// (the subset whose phase actually differs from today — only these need rewiring).
export function proposePhaseBalance(design, txId) {
  const items = balanceableConnections(design, txId);
  const before = { A: 0, B: 0, C: 0 };
  items.forEach(i => { before[i.phase] += i.kva; });
  const totals = { A: 0, B: 0, C: 0 };
  const sorted = [...items].sort((a, b) => b.kva - a.kva);
  // Ties break in favour of the connection's *current* phase (starting the reduction there
  // instead of always 'A') — otherwise an already near-balanced design would still "propose"
  // churning connections around for a differently-shaped but equally-good result, which is just
  // needless rewiring for zero benefit.
  const withNewPhase = sorted.map(item => {
    const lightest = PHASES.reduce((min, ph) => (totals[ph] < totals[min] ? ph : min), item.phase);
    totals[lightest] += item.kva;
    return { ...item, newPhase: lightest };
  });
  // The tie-break above only protects against *exact* ties; re-running the greedy pass in a fresh
  // size order can still land on a different-but-equally-balanced arrangement when several
  // connections happen to be close in size, which would otherwise "propose" real rewiring for zero
  // actual benefit. So only keep the proposal if it's a genuine improvement in max-min spread —
  // otherwise leave every connection right where it already is.
  const spread = (t) => Math.max(t.A, t.B, t.C) - Math.min(t.A, t.B, t.C);
  if (spread(totals) >= spread(before)) {
    return { items: items.map(i => ({ ...i, newPhase: i.phase })), before, after: before, changed: [] };
  }
  const changed = withNewPhase.filter(i => i.newPhase !== i.phase);
  return { items: withNewPhase, before, after: totals, changed };
}

// Applies a phase-balance proposal (see proposePhaseBalance) — updates only the matching
// loads/pv/bess entries' `phase` field; everything else is untouched. Pure, like
// buildSplitCandidate, so the same result can build both the preview design and the real Apply.
export function applyPhaseBalance(design, changed) {
  const byId = {}; changed.forEach(c => { byId[c.id] = c.newPhase; });
  return {
    ...design,
    loads: design.loads.map(l => byId[l.id] ? { ...l, phase: byId[l.id] } : l),
    pv: design.pv.map(p => byId[p.id] ? { ...p, phase: byId[p.id] } : p),
    bess: design.bess.map(b => byId[b.id] ? { ...b, phase: byId[b.id] } : b)
  };
}
