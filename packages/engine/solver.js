// @ts-check
// The load-flow solver: a damped backward-forward sweep per transformer subtree (4-wire, with
// an optional multi-grounded neutral nodal solve), and the snapshot/violation assembly.
import { C, PHASES, PHASE_ANGLE, factorComplexSystem, solveFactoredSystem } from './complex.js';
import { conductorParams, getTransformerType, secondaryLNVoltage, txImpedance, hvMultiplierAt } from './model.js';
import { netS, zipMultiplier, connectionIndex } from './loads.js';
import { vufPct } from './sequence.js';
import { standardsOf } from './standards.js';
import { inverterSettings, inverterOutput } from './inverter.js';
import { couplingMatrix } from './lineModel.js';
import { getConductor } from './model.js';
/** @import { Design, Transformer, SnapshotOptions, SnapshotResult, Violation, Complex } from './types.js' */

/* ============================================================
   LOAD FLOW SOLVER  (ladder / backward-forward sweep, 4-wire multi-grounded neutral)
============================================================ */
// Solves one transformer's subtree (it never electrically touches any other transformer's
// subtree — this is a forest of radial trees, not a meshed network — so each can be solved
// independently with the original single-TX backward-forward sweep).
/**
 * @param {Design} design @param {Transformer} tx
 * @param {{ year: number, hour: number, loadMult: number, solarMult: number, extraPV: import('./types.js').PvConnection[], extraBess?: import('./types.js').BessConnection[], index: import('./loads.js').ConnectionIndex, topo: ReturnType<typeof topologyOf>, initialV?: InitialV | null, bessDispatch?: Record<string, number> | null, extraS?: import('./types.js').ExtraInjection[] }} opts
 */
function solveTxSubtree(design, tx, opts) {
  const { year, hour, loadMult, solarMult, extraPV, extraBess = [], index, topo, initialV, bessDispatch = null, extraS = [] } = opts;
  const hvMult = hvMultiplierAt(tx, hour);
  const V0 = secondaryLNVoltage(tx) * hvMult;
  const V0ph = { A: C.fromPolar(V0, PHASE_ANGLE.A), B: C.fromPolar(V0, PHASE_ANGLE.B), C: C.fromPolar(V0, PHASE_ANGLE.C) };
  // Topology from the per-snapshot maps (see topologyOf): same ids in the same order as
  // design.poles.filter(...) / bfsOrderFrom / children produced, without their O(n²) scans.
  const poleOf = (/** @type {string} */ id) => topo.poleMap.get(id);
  const kidsIn = (/** @type {string} */ id) => topo.kidsMap.get(id) || [];
  const feederRootIds = kidsIn(tx.id);
  const order = [];
  { const queue = [...feederRootIds]; const seen = new Set(queue);
    while (queue.length) { const id = queue.shift(); order.push(id); for (const c of kidsIn(id)) { if (!seen.has(c)) { seen.add(c); queue.push(c); } } } }
  const parentOf = {}; order.forEach(id => parentOf[id] = poleOf(id).parent);
  const kidsOf = {}; order.forEach(id => kidsOf[id] = kidsIn(id));

  // Starting voltages: the open-circuit source EMF everywhere (a "flat" cold start), unless a warm
  // start (initialV, from an earlier converged solve of the same design) supplies a pole's or the
  // bus's phasors. The fixed point is the same either way; a good starting point just reaches it
  // in fewer iterations (see runSnapshot).
  /** @param {import('./types.js').PhaseMap<Complex> | undefined} w */
  const startFrom = (w) => (w ? { A: { ...w.A }, B: { ...w.B }, C: { ...w.C } } : { A: { ...V0ph.A }, B: { ...V0ph.B }, C: { ...V0ph.C } });
  // A subtree with an earth electrode also iterates its neutral potentials (Vn), which always
  // start from zero; pairing warm phase voltages with a cold neutral measured *slower* than a flat
  // start (484 vs 421 iterations over a 24 h scan of the grounded synthetic feeder), so grounded
  // subtrees ignore initialV — and stay bit-identical to a cold start.
  const anyGrounded = order.some(id => { const p = poleOf(id); return p.grounded && Number(p.groundOhms) > 0; });
  const warm = anyGrounded ? null : initialV;
  const V = {}; order.forEach(id => V[id] = startFrom(warm && warm.poles[id]));
  let Icum = {};
  const spanZ = {};
  order.forEach(id => {
    const p = poleOf(id);
    const km = p.spanM / 1000;
    // Neutral impedance gets a tiny length floor (1 cm). Once any pole is grounded, the neutral
    // is solved as a nodal network that divides by each span's neutral impedance (1/Zn for its
    // admittance, ΔVn/Zn for its neutral current) — a 0 m span (a transformer bolted straight onto
    // a pole, e.g. from a feeder split) has Zn = 0 exactly, which turned that span's neutral
    // current and loss into NaN. 1 cm is physically negligible (~6 µΩ) but keeps it finite.
    const kmN = Math.max(km, 1e-5);
    const cp = conductorParams(design, p.cond);
    spanZ[id] = {
      Zph: { re: cp.R * km, im: cp.X * km },
      Zn: { re: cp.Rn * kmN, im: cp.Xn * kmN }
    };
    // Coupled line model (P3.5): the conductor's 4×4 matrix per km, scaled by length — the
    // neutral self term by the same 1 cm-floored length as Zn above, everything else by km — and
    // an unfloored copy for the loss calculation (which, like the simple model, uses km).
    const zm = couplingMatrix(design, getConductor(design, p.cond));
    if (zm) {
      spanZ[id].M = zm.map((row, k) => row.map((z, j) => { const L = k === 3 && j === 3 ? kmN : km; return { re: z.re * L, im: z.im * L }; }));
      spanZ[id].Mloss = zm.map(row => row.map(z => ({ re: z.re * km, im: z.im * km })));
    }
  });

  const txZ = txImpedance(tx, design);
  const txZc = { re: txZ.r, im: txZ.x };
  let Vbus = startFrom(warm && warm.buses[tx.id]);
  let Itot = { A: C.zero(), B: C.zero(), C: C.zero() };

  // Poles with an earth electrode at their neutral. When none exist in this subtree, the nodal
  // solve below never runs at all — the loop falls straight back to the original single
  // Zn·In-per-span formula, unchanged from before this feature existed, so an ungrounded design's
  // results are provably unaffected by any of this. The transformer's own star point is *also*
  // permanently earthed (txGroundOhms) — but a single ground point anywhere in an otherwise
  // radial network only sets an absolute potential nothing here measures (phase-to-*local*-
  // neutral readings are unaffected by it), so it only needs to enter the solve once there's a
  // *second* ground point (a pole) for current to genuinely split between.
  const groundedIds = order.filter(id => { const p = poleOf(id); return p.grounded && Number(p.groundOhms) > 0; });
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
      const p = poleOf(id);
      const i = nodeIdx[id];
      Ymat[i][i] = C.add(Ymat[i][i], { re: 1 / Number(p.groundOhms), im: 0 });
    });
    Ymat[txNodeIdx][txNodeIdx] = C.add(Ymat[txNodeIdx][txNodeIdx], { re: 1 / RgTx, im: 0 });
  }
  // Ymat is fixed for the whole solve (only the injections J change between iterations), so it's
  // eliminated once here; each iteration only replays that elimination on its own J.
  const Yfact = Ymat ? factorComplexSystem(Ymat) : null;
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
  // Each pole's constant-power injections don't depend on voltage, so they're computed once per
  // snapshot here rather than on every iteration; only the ZIP multiplier (which does depend on
  // the iterate's |V|) is applied inside the loop.
  const injections = {}; order.forEach(id => { injections[id] = netS(design, id, year, hour, loadMult, solarMult, extraPV, extraBess, index, bessDispatch); });
  // Constant-power test injections (voltage sensitivity, P4.2): kW / kvar in the load convention,
  // added as they are. Nothing is touched when there are none.
  extraS.forEach(x => {
    const inj = injections[x.pole];
    if (inj) inj.otherS = { ...inj.otherS, [x.phase]: C.add(inj.otherS[x.phase], { re: x.p, im: x.q }) };
  });
  const invSettings = inverterSettings(design);
  // Convergence diagnostics (P4.3): max ΔV of every iteration, and which iteration had the lowest.
  // The sweep is deterministic, so a failed pass's best iterate is recovered by replaying the pass
  // from its starting state up to that iteration. Copying the best iterate as it happens instead
  // made every solve ~60 % slower, to serve only the rare failed one. (V, Vn and Vbus have their
  // entries replaced, never mutated, so shallow copies hold the starting state.)
  /** @type {number[]} */
  const deltaHistory = [];
  // Copied entry by entry: a spread ({ ...V }) here made every later iteration ~50 % slower,
  // presumably by changing how V8 represents V.
  /** @type {Record<string, import('./types.js').PhaseMap<Complex>>} */
  const startV = {};
  /** @type {Record<string, Complex>} */
  const startVn = {};
  order.forEach(id => { startV[id] = V[id]; startVn[id] = Vn[id]; });
  const start = { V: startV, Vbus: { A: Vbus.A, B: Vbus.B, C: Vbus.C }, Vn: startVn, VnTx };
  let bestDelta = Infinity, bestIter = 0, retried = false, retryStart = 0;
  // Passes: the normal sweep; after a failure, a silent replay to the best iterate, then the
  // α = 0.3 retry (see below).
  /** @type {{ maxIter: number, record: boolean }[]} */
  const passes = [{ maxIter: MAX_ITER, record: true }];
  for (let pass = 0; pass < passes.length; pass++) {
  const { maxIter, record } = passes[pass];
  for (let iter = 0; iter < maxIter; iter++) {
    if (record) iterUsed++;
    const Iself = {};
    order.forEach(id => {
      const { loadS, otherS, smart } = injections[id]; const Ip = {};
      PHASES.forEach(ph => {
        const zip = zipMultiplier(design, C.abs(V[id][ph]));
        let S = C.add(C.mulS(loadS[ph], zip), otherS[ph]);
        // Smart-inverter PV on this phase answers to this iterate's voltage (generation = −P − jQ
        // in the load convention used here).
        if (smart.length) {
          const vPu = C.abs(V[id][ph]) / design.vnom;
          smart.forEach(u => { if (u.phase === ph) { const o = inverterOutput(u, vPu, invSettings); S = C.add(S, { re: -o.p, im: -o.q }); } });
        }
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
      const sol = solveFactoredSystem(Yfact, J);
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
      // Coupled span (ungrounded subtree only): ΔV = M·[Ia, Ib, Ic, −In], phase-to-neutral drop
      // ΔV_ph − ΔV_N. Summed from zero term by term, so a diagonal M gives exactly Zph·I + Zn·In.
      let dV = null;
      if (z.M && !groundedIds.length) {
        const I4 = [Icum[id].A, Icum[id].B, Icum[id].C, C.mulS(/** @type {Complex} */ (In), -1)];
        dV = z.M.map(row => row.reduce((s, zkj, j) => C.add(s, C.mul(zkj, I4[j])), C.zero()));
      }
      PHASES.forEach((ph, k) => {
        const raw = groundedIds.length
          ? C.sub(VphaseOnly[id][ph], C.sub(Vn[id], VnTx))
          : dV ? C.sub(Vp[ph], C.sub(dV[k], dV[3]))
            : C.sub(Vp[ph], C.add(C.mul(z.Zph, Icum[id][ph]), C.mul(z.Zn, /** @type {Complex} */ (In))));
        vph[ph] = C.add(V[id][ph], C.mulS(C.sub(raw, V[id][ph]), alpha));
        const d = C.abs(C.sub(vph[ph], V[id][ph]));
        if (d > maxDelta) maxDelta = d;
      });
      newV[id] = vph;
    });
    order.forEach(id => V[id] = newV[id]);
    lastDelta = maxDelta;
    if (record) deltaHistory.push(maxDelta);
    if (maxDelta < TOL) { converged = true; break; }
    if (record && maxDelta < bestDelta) { bestDelta = maxDelta; bestIter = iter + 1; }
    // Not improving (or actively getting worse) — ease off the damping for subsequent
    // iterations rather than let it oscillate indefinitely until MAX_ITER is exhausted.
    if (maxDelta >= prevMaxDelta * 0.999) alpha = Math.max(alpha * 0.6, 0.02);
    prevMaxDelta = maxDelta;
  }
  // Retry once (P4.3): a sweep that used up MAX_ITER restarts from its best iterate with a
  // gentler α = 0.3 (still backing off the same way). A first pass that converges, which is
  // every golden case, never gets here, so its results are unchanged bit for bit.
  if (pass === 0 && !converged && bestIter > 0) {
    retried = true;
    order.forEach(id => { V[id] = start.V[id]; });
    Vbus = { ...start.Vbus }; order.forEach(id => { Vn[id] = start.Vn[id]; }); VnTx = start.VnTx;
    alpha = 0.65; prevMaxDelta = Infinity;
    passes.push({ maxIter: bestIter, record: false }, { maxIter: MAX_ITER, record: true });
  } else if (pass === 1) {
    alpha = 0.3; prevMaxDelta = Infinity; retryStart = deltaHistory.length;
  }
  }
  // Voltage collapse (P4.3): any |V| below half of nominal, any non-finite value, or a retry
  // whose ΔV still grew. Such a load is beyond what the network can deliver, which is a design
  // finding, not a solver hiccup, so it is reported as its own status. (A "converged" solution
  // below 0.5·vnom is the low-voltage branch of the P–V curve and also counts as collapse.)
  let collapsed = false;
  order.forEach(id => PHASES.forEach(ph => {
    const v = C.abs(V[id][ph]);
    if (!Number.isFinite(v) || v < 0.5 * design.vnom) collapsed = true;
  }));
  if (retried && !converged && deltaHistory.length > retryStart && deltaHistory[deltaHistory.length - 1] > deltaHistory[retryStart]) collapsed = true;
  /** @type {'converged' | 'not-converged' | 'collapse'} */
  const status = collapsed ? 'collapse' : converged ? 'converged' : 'not-converged';

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

  // Neutral-point shift at each pole (P5.3 phasor diagram): the local neutral's potential relative
  // to the transformer star point, V. Grounded subtrees get it from the nodal neutral solve; others
  // accumulate the neutral conductor's drop span by span with the same terms the forward sweep
  // used (Zn·In, or the coupled matrix's neutral row). Reported only, it changes no other result.
  /** @type {Record<string, Complex>} */
  const vnShift = {};
  order.forEach(id => {
    if (groundedIds.length) { vnShift[id] = C.sub(Vn[id], VnTx); return; }
    const parent = parentOf[id];
    const up = parent === tx.id ? C.zero() : vnShift[parent];
    const z = spanZ[id];
    const In = C.add(C.add(Icum[id].A, Icum[id].B), Icum[id].C);
    let rise;
    if (z.M) {
      const I4 = [Icum[id].A, Icum[id].B, Icum[id].C, C.mulS(In, -1)];
      rise = C.mulS(z.M[3].reduce((s, zkj, j) => C.add(s, C.mul(zkj, I4[j])), C.zero()), -1);
    } else rise = C.mul(z.Zn, In);
    vnShift[id] = C.add(up, rise);
  });

  const poleResults = order.map(id => {
    const p = poleOf(id);
    const volt = /** @type {import('./types.js').PhaseMap<number>} */ ({}); PHASES.forEach(ph => { volt[ph] = C.abs(V[id][ph]); });
    const cur = /** @type {import('./types.js').PhaseMap<number>} */ ({}); PHASES.forEach(ph => cur[ph] = C.abs(Icum[id][ph]));
    const In = C.abs(spanNeutralCurrent(id));
    const rating = conductorParams(design, p.cond).I;
    let Sspan = C.zero();
    PHASES.forEach(ph => Sspan = C.add(Sspan, C.mul(V[id][ph], C.conj(Icum[id][ph]))));
    const flowKW = Sspan.re / 1000, flowKVAR = Sspan.im / 1000;
    return {
      id, feeder: p.feeder, parent: p.parent, cond: p.cond, spanM: p.spanM,
      volt, vph: { A: { ...V[id].A }, B: { ...V[id].B }, C: { ...V[id].C } }, vn: vnShift[id], vufPct: vufPct(V[id]),
      // Complex span phase currents (P5.6 explain traces), A; `cur` holds their magnitudes.
      icum: { A: { ...Icum[id].A }, B: { ...Icum[id].B }, C: { ...Icum[id].C } },
      inverters: injections[id].smart.map(u => {
        const vPu = C.abs(V[id][u.phase]) / design.vnom;
        const o = inverterOutput(u, vPu, invSettings);
        return { id: u.id, phase: u.phase, mode: u.mode, vPu, pAvailKw: u.pAvail, pKw: o.p, qKvar: o.q, curtailedKw: Math.max(u.pAvail - o.p, 0) };
      }),
      cur, In, rating, condPct: { A: cur.A / rating * 100, B: cur.B / rating * 100, C: cur.C / rating * 100 },
      flowKW, flowKVAR
    };
  });

  let totalLossW = 0;
  const lossByPole = {};
  order.forEach(id => {
    const p = poleOf(id); const km = p.spanM / 1000;
    const cp = conductorParams(design, p.cond);
    const z = spanZ[id];
    const coupled = !!z.Mloss && !groundedIds.length;
    const Rph = cp.R * km, Rn = cp.Rn * km;
    let l = 0;
    PHASES.forEach((ph, k) => l += Math.pow(C.abs(Icum[id][ph]), 2) * (coupled ? z.Mloss[k][k].re : Rph));
    const In = C.abs(spanNeutralCurrent(id));
    l += In * In * (coupled ? z.Mloss[3][3].re : Rn);
    // Mutual terms of a coupled span: Re(Σ_{k≠j} conj(I_k)·Z_kj·I_j) (zero, and skipped, when the
    // matrix is diagonal).
    if (coupled) {
      const I4 = [Icum[id].A, Icum[id].B, Icum[id].C, C.mulS(spanNeutralCurrent(id), -1)];
      for (let k = 0; k < 4; k++) for (let j = 0; j < 4; j++) {
        const zkj = z.Mloss[k][j];
        if (k !== j && (zkj.re !== 0 || zkj.im !== 0)) l += C.mul(C.conj(I4[k]), C.mul(zkj, I4[j])).re;
      }
    }
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
    const p = poleOf(id);
    const Rg = Number(p.groundOhms);
    const Igr = C.abs(C.div(Vn[id], { re: Rg, im: 0 }));
    const l = Igr * Igr * Rg;
    groundLossByPole[id] = l; groundLossW += l;
  });

  let Stx = C.zero();
  feederRootIds.forEach(id => { PHASES.forEach(ph => { Stx = C.add(Stx, C.mul(Vbus[ph], C.conj(Icum[id][ph]))); }); });
  const txKVA = C.abs(Stx) / 1000;
  const txType = getTransformerType(design, tx.txRating);
  const txPct = txKVA / txType.kVA * 100;

  let txLossW = 0;
  PHASES.forEach(ph => txLossW += Math.pow(C.abs(Itot[ph]), 2) * txZ.r);
  const txNoLoadW = (design.txNoLoadW && design.txNoLoadW[tx.txRating] != null)
    ? Number(design.txNoLoadW[tx.txRating])
    : txType.noLoadW;
  const busVoltPct = /** @type {import('./types.js').PhaseMap<number>} */ ({}); PHASES.forEach(ph => busVoltPct[ph] = C.abs(Vbus[ph]));
  // |I| per phase through the transformer (the sum of every feeder root's current) — the true
  // secondary current, which on an unbalanced transformer can be far above a balanced estimate
  // from kVA.
  const phaseCurrentA = /** @type {import('./types.js').PhaseMap<number>} */ ({}); PHASES.forEach(ph => phaseCurrentA[ph] = C.abs(Itot[ph]));

  const netKW = Stx.re / 1000, netKVAR = Stx.im / 1000;
  const flowDirection = /** @type {'import' | 'export'} */ (netKW >= 0 ? 'import' : 'export');

  const couplingIgnored = groundedIds.length ? order.filter(id => spanZ[id].M) : [];
  return {
    converged, iterUsed, lastDelta, poleResults, totalLossW, lossByPole, groundLossW, groundLossByPole, couplingIgnored,
    convergence: { status, retried, deltaHistory },
    summary: {
      id: tx.id, name: tx.name, txKVA, txPct, flowDirection, netKW, netKVAR, busVoltPct,
      busVph: { A: { ...Vbus.A }, B: { ...Vbus.B }, C: { ...Vbus.C } }, busVufPct: vufPct(Vbus), phaseCurrentA, txZ, txLossW, txNoLoadW, V0, hvMultiplier: hvMult,
      itot: { A: { ...Itot.A }, B: { ...Itot.B }, C: { ...Itot.C } } // complex secondary phase currents (P5.6)
    }
  };
}

// Runs one full load-flow snapshot across every transformer in the design.
// options: {year, hour, loadMult, solarMult, extraPV, extraBess}
// Pole lookup and parent → children lists (children in design.poles order, like children()) —
// built once per snapshot so the solver's topology walks are O(n), not O(n²).
/** @param {Design} design */
export function topologyOf(design) {
  const poleMap = new Map(design.poles.map(p => [p.id, p]));
  /** @type {Map<string, string[]>} */
  const kidsMap = new Map();
  design.poles.forEach(p => { const k = kidsMap.get(p.parent); if (k) k.push(p.id); else kidsMap.set(p.parent, [p.id]); });
  return { poleMap, kidsMap };
}

/**
 * Starting phasors for a warm start: every pole's and transformer bus's complex voltage from a
 * previous snapshot of the same design — or null if that snapshot didn't converge (an
 * unconverged iterate is no better a starting point than a flat start, and can be worse).
 * @typedef {{ poles: Record<string, import('./types.js').PhaseMap<Complex>>, buses: Record<string, import('./types.js').PhaseMap<Complex>> }} InitialV
 * @param {SnapshotResult} res
 * @returns {InitialV | null}
 */
export function warmStartFrom(res) {
  if (!res || !res.converged) return null;
  const poles = /** @type {InitialV['poles']} */ ({}); res.poleResults.forEach(p => { poles[p.id] = p.vph; });
  const buses = /** @type {InitialV['buses']} */ ({}); res.transformers.forEach(t => { buses[t.id] = t.busVph; });
  return { poles, buses };
}

/**
 * One load-flow snapshot across every transformer in the design.
 *
 * `ctx` (all optional) lets a caller that runs many snapshots of the same design reuse work:
 *   - index / topo: connectionIndex(design) / topologyOf(design), built here if omitted;
 *   - initialV: a warm start (see warmStartFrom). The damped sweep converges to the same fixed
 *     point from any reasonable start, stopping once the largest voltage change between
 *     iterations is below TOL (1e-4 V); starting from a nearby solution (the previous hour of a
 *     scan, the previous size tried in a hosting search) just gets there in fewer iterations. Two
 *     solves that stop at that tolerance from different starts agree to well within 1e-3 V, so
 *     a warm-started result is the same answer at engineering precision but not bit-for-bit — the
 *     goldens and the reference lock that pin exact snapshot values use cold starts.
 * @param {Design} design @param {SnapshotOptions} opts
 * @param {{ index?: import('./loads.js').ConnectionIndex, topo?: ReturnType<typeof topologyOf>, initialV?: InitialV | null }} [ctx]
 * @returns {SnapshotResult}
 */
export function runSnapshot(design, opts, ctx = {}) {
  const { year, hour, loadMult = 1, solarMult = 1, extraPV = [], extraBess = [], bessDispatch = null, extraS = [] } = opts;
  const index = ctx.index || connectionIndex(design);
  const topo = ctx.topo || topologyOf(design);
  const initialV = ctx.initialV || null;
  const solved = design.transformers.map(tx => solveTxSubtree(design, tx, { year, hour, loadMult, solarMult, extraPV, extraBess, index, topo, initialV, bessDispatch, extraS }));

  const poleResults = solved.flatMap(s => s.poleResults);
  const lossByPole = Object.assign({}, ...solved.map(s => s.lossByPole));
  const totalLossW = solved.reduce((sum, s) => sum + s.totalLossW, 0);
  const groundLossByPole = Object.assign({}, ...solved.map(s => s.groundLossByPole));
  const groundLossW = solved.reduce((sum, s) => sum + s.groundLossW, 0);
  const converged = solved.every(s => s.converged);
  const iterUsed = Math.max(...solved.map(s => s.iterUsed));
  const lastDelta = Math.max(...solved.map(s => s.lastDelta));
  const transformers = solved.map(s => s.summary);
  // Convergence diagnostics per transformer, and the snapshot's overall status (P4.3).
  const convergence = solved.map((s, i) => ({ txId: design.transformers[i].id, ...s.convergence }));
  /** @type {'converged' | 'not-converged' | 'collapse'} */
  const status = convergence.some(c => c.status === 'collapse') ? 'collapse' : converged ? 'converged' : 'not-converged';
  // Coupled spans in subtrees with earth electrodes fall back to the uncoupled model (lineModel.js).
  const couplingIgnored = solved.flatMap(s => s.couplingIgnored);

  const vLimLow = design.vnom * (1 - design.vdev / 100), vLimHigh = design.vnom * (1 + design.vdev / 100);
  // Loading limits from the design's standards (P2.7); 100 % of rating unless a profile says
  // otherwise — exactly the historical behaviour.
  const lim = standardsOf(design);
  const cableLimitPct = lim.cableLoadingLimitPct, txLimitPct = lim.txLoadingLimitPct;
  let violations = [];
  poleResults.forEach(pr => {
    PHASES.forEach(ph => {
      if (pr.volt[ph] < vLimLow) violations.push({ pole: pr.id, phase: ph, type: 'undervoltage', value: pr.volt[ph] });
      if (pr.volt[ph] > vLimHigh) violations.push({ pole: pr.id, phase: ph, type: 'overvoltage', value: pr.volt[ph] });
    });
    PHASES.forEach(ph => { if (pr.condPct[ph] > cableLimitPct) violations.push({ pole: pr.id, phase: ph, type: 'thermal', value: pr.condPct[ph] }); });
  });
  // Transformer overload counts when importing — or in either direction when the standards say
  // so (O3.5). Reverse flow above the limit is always listed in reverseFlowOverloads, so a page
  // can warn about it even under the import-only rule.
  transformers.forEach(t => {
    if (t.txPct > txLimitPct && (t.flowDirection === 'import' || lim.txLimitBothDirections)) violations.push({ pole: t.id, phase: '-', type: 'transformer overload', value: t.txPct });
  });
  const reverseFlowOverloads = transformers.filter(t => t.flowDirection === 'export' && t.txPct > txLimitPct).map(t => ({ txId: t.id, pct: t.txPct, counted: lim.txLimitBothDirections }));

  // Voltage unbalance (P2.1): always reported per pole (vufPct) and as the snapshot's worst; only
  // raised as an 'unbalance' violation when the design's standards ask for it — off by default, so
  // hosting, feeder-split and every other ranking is unchanged unless the user opts in.
  const standards = lim;
  const vufLimitPct = lim.vufLimitPct;
  /** @type {{ pole: string, value: number } | null} */
  let worstVuf = null;
  poleResults.forEach(pr => {
    if (!worstVuf || pr.vufPct > worstVuf.value) worstVuf = { pole: pr.id, value: pr.vufPct };
    if (standards.vufAsViolation && pr.vufPct > vufLimitPct) violations.push({ pole: pr.id, phase: '-', type: 'unbalance', value: pr.vufPct });
  });

  return {
    converged, status, convergence, iterUsed, lastDelta, poleResults, totalLossW, lossByPole, groundLossW, groundLossByPole, transformers,
    violations, vLimLow, vLimHigh, vufLimitPct, worstVuf, year, hour, loadMult, solarMult, reverseFlowOverloads,
    ...(design.lineModel === 'coupled' ? { lineModel: 'coupled', couplingIgnored } : {})
  };
}
