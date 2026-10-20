// @ts-check
// The load-flow solver: a damped backward-forward sweep per transformer subtree (4-wire, with
// an optional multi-grounded neutral nodal solve), and the snapshot/violation assembly.
import { C, PHASES, PHASE_ANGLE, solveComplexLinearSystem } from './complex.js';
import { CONDUCTORS, TRANSFORMERS, condX, condRn, condXn, poleById, children, bfsOrderFrom, secondaryLNVoltage, txImpedance } from './model.js';
import { netS, zipMultiplier } from './loads.js';
/** @import { Design, Transformer, SnapshotOptions, SnapshotResult, Violation, Complex } from './types.js' */

/* ============================================================
   LOAD FLOW SOLVER  (ladder / backward-forward sweep, 4-wire multi-grounded neutral)
============================================================ */
// Solves one transformer's subtree (it never electrically touches any other transformer's
// subtree — this is a forest of radial trees, not a meshed network — so each can be solved
// independently with the original single-TX backward-forward sweep).
/**
 * @param {Design} design @param {Transformer} tx
 * @param {{ year: number, hour: number, loadMult: number, solarMult: number, extraPV: import('./types.js').PvConnection[], extraBess?: import('./types.js').BessConnection[] }} opts
 */
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
    // Neutral impedance gets a tiny length floor (1 cm). Once any pole is grounded, the neutral
    // is solved as a nodal network that divides by each span's neutral impedance (1/Zn for its
    // admittance, ΔVn/Zn for its neutral current) — a 0 m span (a transformer bolted straight onto
    // a pole, e.g. from a feeder split) has Zn = 0 exactly, which turned that span's neutral
    // current and loss into NaN. 1 cm is physically negligible (~6 µΩ) but keeps it finite.
    const kmN = Math.max(km, 1e-5);
    spanZ[id] = {
      Zph: { re: CONDUCTORS[p.cond].R * km, im: condX(p.cond) * km },
      Zn: { re: condRn(p.cond) * kmN, im: condXn(p.cond) * kmN }
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
      // A 0m span (e.g. a new transformer bolted directly onto its cut/site pole) has zero neutral
      // impedance, so the true admittance is infinite — dividing by the exact-zero Zn would produce
      // NaN and poison the whole matrix solve. Treat it as a near-perfect tie (a very large but
      // finite admittance) instead: electrically equivalent (no voltage drop across 0m of neutral
      // either way), but keeps every downstream Vn/VnTx value finite.
      const zn = spanZ[id].Zn;
      const ySpan = (zn.re * zn.re + zn.im * zn.im) > 0 ? C.div({ re: 1, im: 0 }, zn) : { re: 1e9, im: 0 };
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
    /** @type {Record<string, import('./types.js').PhaseMap<Complex>>} */
    let VphaseOnly = null;
    if (groundedIds.length) {
      VphaseOnly = {};
      order.forEach(id => {
        const parent = parentOf[id];
        const Vp = parent === tx.id ? Vbus : VphaseOnly[parent];
        const z = spanZ[id];
        const vph = /** @type {import('./types.js').PhaseMap<Complex>} */ ({});
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
          : C.sub(Vp[ph], C.add(C.mul(z.Zph, Icum[id][ph]), C.mul(z.Zn, /** @type {Complex} */ (In))));
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
    const volt = /** @type {import('./types.js').PhaseMap<number>} */ ({}); PHASES.forEach(ph => { volt[ph] = C.abs(V[id][ph]); });
    const cur = /** @type {import('./types.js').PhaseMap<number>} */ ({}); PHASES.forEach(ph => cur[ph] = C.abs(Icum[id][ph]));
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
  const busVoltPct = /** @type {import('./types.js').PhaseMap<number>} */ ({}); PHASES.forEach(ph => busVoltPct[ph] = C.abs(Vbus[ph]));

  const netKW = Stx.re / 1000, netKVAR = Stx.im / 1000;
  const flowDirection = /** @type {'import' | 'export'} */ (netKW >= 0 ? 'import' : 'export');

  return {
    converged, iterUsed, lastDelta, poleResults, totalLossW, lossByPole, groundLossW, groundLossByPole,
    summary: { id: tx.id, name: tx.name, txKVA, txPct, flowDirection, netKW, netKVAR, busVoltPct, txZ, txLossW, txNoLoadW, V0 }
  };
}

// Runs one full load-flow snapshot across every transformer in the design.
// options: {year, hour, loadMult, solarMult, extraPV, extraBess}
/** @param {Design} design @param {SnapshotOptions} opts @returns {SnapshotResult} */
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
