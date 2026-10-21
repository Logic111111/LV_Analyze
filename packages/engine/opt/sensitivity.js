// @ts-check
// Linearised network model (O1.3): the Jacobian of every pole-phase voltage magnitude, every span
// phase loading % and every transformer's kVA with respect to power injected at chosen pole-phase
// locations, at one solved operating point. The hosting optimiser (O3.2) builds its LP from it.
//
// Semi-analytic method — linearise the backward-forward sweep itself:
//   - A generation change ΔP (kW, unity pf) at pole k, phase φ changes the current drawn there by
//     ΔI = conj(−1000·ΔP / V_kφ)  (A, load convention: generation is negative load).
//   - Backward: every span on the path from k to the transformer carries ΔI more on phase φ, and
//     its neutral ΔIn = ΔIa + ΔIb + ΔIc more.
//   - Forward: each span's phase-to-neutral drop changes by Zph·ΔI_φ + Zn·ΔIn, and the transformer
//     bus by Ztx·ΔItot. The neutral term is the same on all three phases of the span: an injection
//     on phase A moves the B and C voltages too — the neutral-shift coupling that makes a balanced
//     three-phase injection host far more than three single-phase ones.
//   - Every constant-power load and generator responds to the voltage change: I = conj(S/V), so
//     ΔI = −I·conj(ΔV/V). That changes the drops again; four fixed-point rounds of
//     "currents → voltages → load response" converge (each round shrinks the error by roughly the
//     per-unit voltage drop).
//   - Magnitudes: Δ|V| = Re(conj(V)·ΔV)/|V|, and the same for span currents and transformer kVA.
// Each location costs a few O(n) sweeps. The result is the exact first-order derivative of the
// solved equations for the simple (uncoupled, ungrounded, constant-power) model — the default.
// Designs with earthed poles (a nodal neutral), coupled 4×4 spans, ZIP loads or smart inverters
// fall back to central finite differences: two full load flows per location (±0.5 kW), which is
// also how the tests validate the semi-analytic values.
import { C, PHASES } from '../complex.js';
import { conductorParams, getTransformerType } from '../model.js';
import { runSnapshot, warmStartFrom, topologyOf } from '../solver.js';
import { connectionIndex } from '../loads.js';
/** @import { Design, Phase, Complex, SnapshotResult, SnapshotOptions } from '../types.js' */
/** @typedef {{ pole: string, phase: Phase }} Location */
/**
 * @typedef {object} NetworkJacobian
 * @property {'semi-analytic' | 'finite-difference'} method
 * @property {'P' | 'Q'} quantity
 * @property {Location[]} locations
 * @property {{ pole: string, phase: Phase, value: number, grad: number[] }[]} volt   |V| (V) and ∂|V|/∂x (V per kW or kvar injected)
 * @property {{ pole: string, phase: Phase, pct: number, rating: number, grad: number[] }[]} spans  span loading (% of rating) and ∂/∂x (% per kW)
 * @property {{ id: string, kva: number, pct: number, ratingKva: number, netKW: number, grad: number[], gradNetKW: number[] }[]} tx  transformer |S| (kVA) and ∂|S|/∂x
 */

const LOAD_RESPONSE_ROUNDS = 4;

/** Whether the semi-analytic method applies to this design and solution (see the module comment). @param {Design} design @param {SnapshotResult} res */
export function semiAnalyticSupported(design, res) {
  if (design.loadModel === 'zip' || design.lineModel === 'coupled') return false;
  if (design.poles.some(p => p.grounded && Number(p.groundOhms) > 0)) return false;
  return !res.poleResults.some(pr => pr.inverters && pr.inverters.length);
}

/**
 * Semi-analytic Jacobian at a solved snapshot of `design` (see the module comment).
 * @param {Design} design @param {SnapshotResult} res @param {Location[]} locations
 * @param {{ quantity?: 'P' | 'Q' }} [opts]
 * @returns {NetworkJacobian}
 */
export function networkJacobian(design, res, locations, opts = {}) {
  const quantity = opts.quantity === 'Q' ? 'Q' : 'P';
  const { kidsMap } = topologyOf(design);
  const prById = new Map(res.poleResults.map(pr => [pr.id, pr]));
  const txIds = design.transformers.map(t => t.id);
  // Children before parents (reverse breadth-first from each transformer).
  /** @type {string[]} */
  const order = [];
  txIds.forEach(t => { const q = [...(kidsMap.get(t) || [])]; while (q.length) { const id = /** @type {string} */ (q.shift()); if (prById.has(id)) { order.push(id); q.push(...(kidsMap.get(id) || [])); } } });
  const rev = order.slice().reverse();
  const parentOf = new Map(order.map(id => [id, /** @type {any} */ (prById.get(id)).parent]));
  // Span impedances exactly as the solver forms them (the neutral's 1 cm length floor included).
  /** @type {Map<string, { Zph: Complex, Zn: Complex }>} */
  const z = new Map();
  order.forEach(id => {
    const pr = /** @type {any} */ (prById.get(id));
    const cp = conductorParams(design, pr.cond), km = pr.spanM / 1000, kmN = Math.max(km, 1e-5);
    z.set(id, { Zph: { re: cp.R * km, im: cp.X * km }, Zn: { re: cp.Rn * kmN, im: cp.Xn * kmN } });
  });
  const txById = new Map(res.transformers.map(t => [t.id, t]));
  // Each node's own constant-power current: its span current minus its children's.
  /** @type {Map<string, Record<Phase, Complex>>} */
  const Iself = new Map();
  order.forEach(id => {
    const own = /** @type {any} */ (prById.get(id)).icum;
    const v = { A: { ...own.A }, B: { ...own.B }, C: { ...own.C } };
    (kidsMap.get(id) || []).forEach(k => { const ki = /** @type {any} */ (prById.get(k)); if (ki) PHASES.forEach(ph => { v[ph] = C.sub(v[ph], ki.icum[ph]); }); });
    Iself.set(id, v);
  });
  const Vof = (/** @type {string} */ id) => /** @type {any} */ (prById.get(id)).vph;

  /** Voltage changes for node current changes dI (load convention, A). @param {Map<string, Record<Phase, Complex>>} dI */
  function sweep(dI) {
    /** @type {Map<string, Record<Phase, Complex>>} */
    const dIcum = new Map();
    rev.forEach(id => {
      const own = dI.get(id);
      const t = { A: own ? own.A : C.zero(), B: own ? own.B : C.zero(), C: own ? own.C : C.zero() };
      (kidsMap.get(id) || []).forEach(k => { const kc = dIcum.get(k); if (kc) PHASES.forEach(ph => { t[ph] = C.add(t[ph], kc[ph]); }); });
      dIcum.set(id, t);
    });
    /** @type {Map<string, Record<Phase, Complex>>} */
    const dVbus = new Map(), dItot = new Map();
    txIds.forEach(t => {
      const tot = { A: C.zero(), B: C.zero(), C: C.zero() };
      (kidsMap.get(t) || []).forEach(r => { const rc = dIcum.get(r); if (rc) PHASES.forEach(ph => { tot[ph] = C.add(tot[ph], rc[ph]); }); });
      const tz = /** @type {any} */ (txById.get(t)).txZ;
      dItot.set(t, tot);
      dVbus.set(t, { A: C.mul({ re: -tz.r, im: -tz.x }, tot.A), B: C.mul({ re: -tz.r, im: -tz.x }, tot.B), C: C.mul({ re: -tz.r, im: -tz.x }, tot.C) });
    });
    /** @type {Map<string, Record<Phase, Complex>>} */
    const dV = new Map();
    order.forEach(id => {
      const p = parentOf.get(id);
      const up = dV.get(p) || dVbus.get(p);
      const ic = /** @type {Record<Phase, Complex>} */ (dIcum.get(id)), zz = /** @type {{ Zph: Complex, Zn: Complex }} */ (z.get(id));
      const nDrop = C.mul(zz.Zn, C.add(C.add(ic.A, ic.B), ic.C));
      dV.set(id, { A: C.sub(/** @type {any} */ (up).A, C.add(C.mul(zz.Zph, ic.A), nDrop)), B: C.sub(/** @type {any} */ (up).B, C.add(C.mul(zz.Zph, ic.B), nDrop)), C: C.sub(/** @type {any} */ (up).C, C.add(C.mul(zz.Zph, ic.C), nDrop)) });
    });
    return { dV, dIcum, dVbus, dItot };
  }

  const n = locations.length;
  const volt = order.flatMap(id => PHASES.map(ph => ({ pole: id, phase: ph, value: C.abs(Vof(id)[ph]), grad: Array(n).fill(0) })));
  const voltIdx = new Map(volt.map((v, i) => [`${v.pole}|${v.phase}`, i]));
  const spans = order.flatMap(id => { const pr = /** @type {any} */ (prById.get(id)); return PHASES.map(ph => ({ pole: id, phase: ph, pct: pr.condPct[ph], rating: pr.rating, grad: Array(n).fill(0) })); });
  const tx = res.transformers.map(t => ({ id: t.id, kva: t.txKVA, pct: t.txPct, ratingKva: getTransformerType(design, /** @type {any} */ (design.transformers.find(d => d.id === t.id)).txRating).kVA, netKW: t.netKW, grad: Array(n).fill(0), gradNetKW: Array(n).fill(0) }));

  locations.forEach((loc, li) => {
    const V = Vof(loc.pole)[loc.phase];
    // Generation of 1 kW (or 1 kvar) = a load of −1 (or −j): ΔI = conj(ΔS·1000 / V).
    const dS = quantity === 'P' ? { re: -1000, im: 0 } : { re: 0, im: -1000 };
    const inj = C.conj(C.div(dS, V));
    /** @type {Map<string, Record<Phase, Complex>>} */
    let dI = new Map([[loc.pole, { A: C.zero(), B: C.zero(), C: C.zero(), [loc.phase]: inj }]]);
    let out = sweep(dI);
    for (let r = 0; r < LOAD_RESPONSE_ROUNDS; r++) {
      // Constant-power response of everything connected: ΔI = −I·conj(ΔV/V).
      const next = new Map();
      order.forEach(id => {
        const I0 = /** @type {Record<Phase, Complex>} */ (Iself.get(id)), dv = /** @type {Record<Phase, Complex>} */ (out.dV.get(id)), v = Vof(id);
        const e = /** @type {Record<Phase, Complex>} */ ({});
        PHASES.forEach(ph => { e[ph] = C.mul(C.mulS(I0[ph], -1), C.conj(C.div(dv[ph], v[ph]))); });
        if (id === loc.pole) e[loc.phase] = C.add(e[loc.phase], inj);
        next.set(id, e);
      });
      dI = next;
      out = sweep(dI);
    }
    order.forEach(id => {
      const v = Vof(id), dv = /** @type {Record<Phase, Complex>} */ (out.dV.get(id));
      const pr = /** @type {any} */ (prById.get(id)), ic = /** @type {Record<Phase, Complex>} */ (out.dIcum.get(id));
      PHASES.forEach(ph => {
        volt[/** @type {number} */ (voltIdx.get(`${id}|${ph}`))].grad[li] = C.mul(C.conj(v[ph]), dv[ph]).re / C.abs(v[ph]);
        const I = pr.icum[ph], mag = C.abs(I);
        const dMag = mag > 1e-9 ? C.mul(C.conj(I), ic[ph]).re / mag : C.abs(ic[ph]);
        spans[/** @type {number} */ (voltIdx.get(`${id}|${ph}`))].grad[li] = dMag / pr.rating * 100; // same order as volt
      });
    });
    tx.forEach((t, ti) => {
      const s = /** @type {any} */ (res.transformers[ti]);
      const dVb = /** @type {Record<Phase, Complex>} */ (out.dVbus.get(t.id)), dIt = /** @type {Record<Phase, Complex>} */ (out.dItot.get(t.id));
      let S = C.zero(), dSum = C.zero();
      PHASES.forEach(ph => {
        S = C.add(S, C.mul(s.busVph[ph], C.conj(s.itot[ph])));
        dSum = C.add(dSum, C.add(C.mul(dVb[ph], C.conj(s.itot[ph])), C.mul(s.busVph[ph], C.conj(dIt[ph]))));
      });
      const mag = C.abs(S);
      t.grad[li] = (mag > 1e-9 ? C.mul(C.conj(S), dSum).re / mag : C.abs(dSum)) / 1000;
      t.gradNetKW[li] = dSum.re / 1000;
    });
  });
  return { method: 'semi-analytic', quantity, locations, volt, spans, tx };
}

/**
 * Central finite-difference Jacobian: two full load flows per location (±delta kW or kvar of
 * generation), the same quantities as networkJacobian. The fallback for models the semi-analytic
 * method doesn't cover, and its check.
 * @param {Design} design @param {SnapshotOptions} snapOpts @param {Location[]} locations
 * @param {{ quantity?: 'P' | 'Q', delta?: number, base?: SnapshotResult }} [opts]
 * @returns {NetworkJacobian & { base: SnapshotResult, converged: boolean }}
 */
export function finiteDifferenceJacobian(design, snapOpts, locations, opts = {}) {
  const quantity = opts.quantity === 'Q' ? 'Q' : 'P';
  const delta = opts.delta ?? 0.5;
  const ctx = { index: connectionIndex(design), topo: topologyOf(design) };
  const base = opts.base || runSnapshot(design, snapOpts, ctx);
  const initialV = warmStartFrom(base);
  let converged = base.converged;
  const n = locations.length;
  const volt = base.poleResults.flatMap(pr => PHASES.map(ph => ({ pole: pr.id, phase: ph, value: pr.volt[ph], grad: Array(n).fill(0) })));
  const spans = base.poleResults.flatMap(pr => PHASES.map(ph => ({ pole: pr.id, phase: ph, pct: pr.condPct[ph], rating: pr.rating, grad: Array(n).fill(0) })));
  const tx = base.transformers.map(t => ({ id: t.id, kva: t.txKVA, pct: t.txPct, ratingKva: getTransformerType(design, /** @type {any} */ (design.transformers.find(d => d.id === t.id)).txRating).kVA, netKW: t.netKW, grad: Array(n).fill(0), gradNetKW: Array(n).fill(0) }));
  locations.forEach((loc, li) => {
    // Load convention in extraS: +delta of generation is a load of −delta.
    const solve = (/** @type {number} */ g) => {
      const r = runSnapshot(design, { ...snapOpts, extraS: [...(snapOpts.extraS || []), { pole: loc.pole, phase: loc.phase, p: quantity === 'P' ? -g : 0, q: quantity === 'Q' ? -g : 0 }] }, { ...ctx, initialV });
      converged = converged && r.converged;
      return r;
    };
    const up = solve(delta), down = solve(-delta);
    let k = 0;
    up.poleResults.forEach((pr, i) => PHASES.forEach(ph => {
      volt[k].grad[li] = (pr.volt[ph] - down.poleResults[i].volt[ph]) / (2 * delta);
      spans[k].grad[li] = (pr.condPct[ph] - down.poleResults[i].condPct[ph]) / (2 * delta);
      k++;
    }));
    tx.forEach((t, ti) => {
      t.grad[li] = (up.transformers[ti].txKVA - down.transformers[ti].txKVA) / (2 * delta);
      t.gradNetKW[li] = (up.transformers[ti].netKW - down.transformers[ti].netKW) / (2 * delta);
    });
  });
  return { method: 'finite-difference', quantity, locations, volt, spans, tx, base, converged };
}

/**
 * The Jacobian at a snapshot: semi-analytic where it applies, finite differences otherwise.
 * @param {Design} design @param {SnapshotOptions} snapOpts @param {Location[]} locations
 * @param {{ quantity?: 'P' | 'Q', base?: SnapshotResult, ctx?: any }} [opts]
 * @returns {NetworkJacobian & { base: SnapshotResult }}
 */
export function jacobianAt(design, snapOpts, locations, opts = {}) {
  const base = opts.base || runSnapshot(design, snapOpts, opts.ctx || {});
  if (semiAnalyticSupported(design, base)) return { ...networkJacobian(design, base, locations, opts), base };
  return finiteDifferenceJacobian(design, snapOpts, locations, { ...opts, base });
}
