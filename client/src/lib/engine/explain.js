// @ts-check
// "Explain this number" (P5.6): each function rebuilds one result from its parts and returns a
// structured trace — formula, substituted values, result — in the hand-calculation workbook's
// style. The parts come from the solved snapshot (complex currents and voltages), so the trace
// adds up to the reported number. Tests check that it does. The drawer in the UI only renders.
//
// Trace: { kind, title, steps: [{ label, formula, substituted, value, unit }], result: { label,
// value, unit }, check?: { label, value, unit }, notes: string[] }
import { C, PHASES, PHASE_ANGLE } from './complex.js';
import { poleById, isTransformerId, transformerOfPole, conductorParams, getConductor, getTransformerType, txImpedance } from './model.js';
import { couplingMatrix } from './lineModel.js';
import { faultSettings, sourceImpedance, ALPHA_AL_PER_K } from './faults.js';
/** @import { Design, SnapshotResult, Complex, Phase } from './types.js' */

const f = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : '—');
/** "a + jb" @param {Complex} z */
export const rect = (z, d = 3) => `${f(z.re, d)} ${z.im < 0 ? '−' : '+'} j${f(Math.abs(z.im), d)}`;
/** "m∠θ°" @param {Complex} z */
export const polar = (z, d = 2) => `${f(C.abs(z), d)}∠${f(Math.atan2(z.im, z.re) * 180 / Math.PI, 1)}°`;
const step = (label, formula, substituted, value, unit = '') => ({ label, formula, substituted, value, unit });

/** Poles from the feeder root out to `poleId`. @param {Design} design @param {string} poleId */
function pathTo(design, poleId) {
  const chain = [];
  let cur = poleId;
  while (!isTransformerId(design, cur)) { chain.unshift(cur); const p = poleById(design, cur); if (!p) break; cur = p.parent; }
  return chain;
}

/**
 * Phase-to-neutral voltage at a pole: V = V0 − ΔV_T − Σ ΔV_phase − Σ ΔV_neutral, every term a
 * phasor, with each term's in-phase part (its share of the magnitude drop) alongside.
 * @param {Design} design @param {SnapshotResult} res @param {string} poleId @param {Phase} ph
 */
export function explainPoleVoltage(design, res, poleId, ph) {
  const txId = /** @type {string} */ (transformerOfPole(design, poleId));
  const tr = /** @type {any} */ (res.transformers.find(t => t.id === txId));
  const prOf = (id) => /** @type {any} */ (res.poleResults.find(p => p.id === id));
  const pr = prOf(poleId);
  const V0 = C.fromPolar(tr.V0, PHASE_ANGLE[ph]);
  const u = C.mulS(V0, 1 / C.abs(V0));
  const inPhase = (/** @type {Complex} */ dv) => C.mul(dv, C.conj(u)).re;
  const steps = [];
  steps.push(step('No-load LV phase voltage', 'V0 = U(LN, no load) ∠ phase angle', `${f(tr.V0, 2)} V ∠${PHASE_ANGLE[ph]}° (tap ${design.transformers.find(t => t.id === txId).tap}${tr.hvMultiplier !== 1 ? `, HV ×${tr.hvMultiplier}` : ''})`, V0, 'V'));
  const zt = { re: tr.txZ.r, im: tr.txZ.x };
  const dT = C.mul(zt, tr.itot[ph]);
  steps.push(step('Transformer drop', 'ΔV_T = Z_T · I_T', `(${rect(zt, 4)}) Ω × (${polar(tr.itot[ph])}) A`, dT, 'V'));
  let sumPh = C.zero(), sumN = C.zero();
  let prevVn = C.zero();
  const coupled = design.lineModel === 'coupled';
  pathTo(design, poleId).forEach(id => {
    const p = poleById(design, id), r = prOf(id);
    const cp = conductorParams(design, p.cond), km = p.spanM / 1000;
    const M = coupled ? couplingMatrix(design, getConductor(design, p.cond)) : null;
    let dPh;
    if (M) {
      const In = C.add(C.add(r.icum.A, r.icum.B), r.icum.C);
      const I4 = [r.icum.A, r.icum.B, r.icum.C, C.mulS(In, -1)];
      const k = PHASES.indexOf(ph);
      dPh = M[k].reduce((s, z, j) => C.add(s, C.mul({ re: z.re * km, im: z.im * km }, I4[j])), C.zero());
      steps.push(step(`Span into ${id}: phase ${ph} conductor (coupled)`, 'ΔV_ph = Σ_j Z_kj·L · I_j  (4×4 matrix row)', `${p.spanM} m of ${p.cond}, I_ph = ${polar(r.icum[ph])} A`, dPh, 'V'));
    } else {
      const z = { re: cp.R * km, im: cp.X * km };
      dPh = C.mul(z, r.icum[ph]);
      steps.push(step(`Span into ${id}: phase ${ph} conductor`, 'ΔV_ph = (R + jX)·L · I_ph', `(${f(cp.R, 4)} + j${f(cp.X, 4)}) Ω/km × ${f(km, 3)} km × ${polar(r.icum[ph])} A`, dPh, 'V'));
    }
    const dN = C.sub(r.vn, prevVn);
    const In = C.add(C.add(r.icum.A, r.icum.B), r.icum.C);
    steps.push(step(`Span into ${id}: neutral`, 'ΔV_N = rise of the local neutral = Z_N·L · I_N (no earth electrodes)', p.grounded || res.groundLossW > 0
      ? 'from the neutral network solve (earth electrodes share the return current)'
      : `(${f(cp.Rn, 4)} + j${f(cp.Xn, 4)}) Ω/km × ${f(Math.max(km, 1e-5), 3)} km × ${polar(In)} A`, dN, 'V'));
    sumPh = C.add(sumPh, dPh); sumN = C.add(sumN, dN); prevVn = r.vn;
  });
  const V = C.sub(C.sub(C.sub(V0, dT), sumPh), sumN);
  const resid = C.abs(C.sub(V, pr.vph[ph]));
  return {
    kind: 'poleVoltage', title: `Voltage at ${poleId}, phase ${ph}`,
    steps: steps.map(s => ({ ...s, inPhaseV: s.label.startsWith('No-load') ? null : inPhase(s.value) })),
    result: { label: `V = V0 − ΔV_T − ΣΔV_ph − ΣΔV_N = ${polar(V)} V`, value: C.abs(V), unit: 'V' },
    check: { label: 'Load-flow result', value: pr.volt[ph], unit: 'V' },
    notes: [
      `Each drop's in-phase part (projection on V0) is roughly its share of the magnitude drop: ${f(tr.V0, 2)} V − ${f(C.abs(V), 2)} V = ${f(tr.V0 - C.abs(V), 2)} V in all.`,
      `The neutral terms raise the local neutral (N′) above the transformer star point by |ΣΔV_N| = ${f(C.abs(sumN), 2)} V — they lower a heavily loaded phase and can raise a lightly loaded one.`,
      `Rebuilt from the snapshot's currents; differs from the load-flow figure by ${f(resid, 4)} V (the solver's stopping tolerance is 1e-4 V per iteration).`
    ]
  };
}

/** Span loading: worst phase current over the conductor rating. @param {Design} design @param {SnapshotResult} res @param {string} poleId */
export function explainSpanLoading(design, res, poleId) {
  const p = /** @type {any} */ (poleById(design, poleId)), pr = /** @type {any} */ (res.poleResults.find(x => x.id === poleId));
  const Iz = conductorParams(design, p.cond).I;
  const steps = PHASES.map(ph => step(`Phase ${ph}`, 'loading = |I_ph| / Iz × 100 %', `${f(C.abs(pr.icum[ph]), 1)} A / ${Iz} A × 100`, C.abs(pr.icum[ph]) / Iz * 100, '%'));
  const worst = Math.max(...steps.map(s => s.value));
  return {
    kind: 'spanLoading', title: `Loading of the span into ${poleId} (${p.cond})`, steps,
    result: { label: 'Worst phase', value: worst, unit: '%' }, check: { label: 'Reported', value: Math.max(pr.condPct.A, pr.condPct.B, pr.condPct.C), unit: '%' },
    notes: [`Iz = ${Iz} A is the conductor's current rating from the library.`]
  };
}

/** Span loss: Σ|I_ph|²·R·L + |I_N|²·Rn·L. @param {Design} design @param {SnapshotResult} res @param {string} poleId */
export function explainSpanLoss(design, res, poleId) {
  const p = /** @type {any} */ (poleById(design, poleId)), pr = /** @type {any} */ (res.poleResults.find(x => x.id === poleId));
  const cp = conductorParams(design, p.cond), km = p.spanM / 1000;
  const steps = PHASES.map(ph => step(`Phase ${ph}`, 'P = |I_ph|² · R · L', `${f(pr.cur[ph], 2)}² A² × ${f(cp.R, 4)} Ω/km × ${f(km, 3)} km`, pr.cur[ph] ** 2 * cp.R * km, 'W'));
  steps.push(step('Neutral', 'P = |I_N|² · Rn · L', `${f(pr.In, 2)}² A² × ${f(cp.Rn, 4)} Ω/km × ${f(km, 3)} km`, pr.In ** 2 * cp.Rn * km, 'W'));
  const total = steps.reduce((s, x) => s + x.value, 0);
  return {
    kind: 'spanLoss', title: `Loss in the span into ${poleId}`, steps,
    result: { label: 'Total', value: total, unit: 'W' }, check: { label: 'Reported', value: res.lossByPole[poleId], unit: 'W' },
    notes: design.lineModel === 'coupled' && couplingMatrix(design, getConductor(design, p.cond)) ? ['Coupled line model: the reported figure also has the mutual-impedance terms Re(Σ conj(I_k)·Z_kj·I_j), not shown here.'] : []
  };
}

/** Transformer loading: |Σ V_bus·I*| over the rating. @param {Design} design @param {SnapshotResult} res @param {string} txId */
export function explainTxLoading(design, res, txId) {
  const tr = /** @type {any} */ (res.transformers.find(t => t.id === txId));
  const tx = /** @type {any} */ (design.transformers.find(t => t.id === txId));
  const steps = PHASES.map(ph => {
    const S = C.mulS(C.mul(tr.busVph[ph], C.conj(tr.itot[ph])), 1 / 1000);
    return step(`Phase ${ph}`, 'S_ph = V_bus,ph · I*_ph', `${polar(tr.busVph[ph])} V × (${polar(tr.itot[ph])} A)*`, S, 'kVA');
  });
  const S = steps.reduce((s, x) => C.add(s, x.value), C.zero());
  const rated = getTransformerType(design, tx.txRating).kVA;
  steps.push(step('Total', 'S = S_A + S_B + S_C', rect(S, 2) + ' kVA', S, 'kVA'));
  return {
    kind: 'txLoading', title: `Loading of transformer ${tx.name || txId}`, steps,
    result: { label: `|S| / S_rated = ${f(C.abs(S), 2)} / ${rated} kVA`, value: C.abs(S) / rated * 100, unit: '%' },
    check: { label: 'Reported', value: tr.txPct, unit: '%' },
    notes: [`P = ${f(S.re, 2)} kW (${S.re >= 0 ? 'import from the grid' : 'export to the grid'}), Q = ${f(S.im, 2)} kvar. Loading uses |S| on the LV side, so it counts reverse power flow too.`]
  };
}

/**
 * Prospective fault currents at a pole: Ik3max = c_max·U_LN / |Zq + Z_T + Σ Z_ph,20| and
 * Ik1min = c_min·U_LN / |Zq + Z_T + Σ (Z_ph + Z_N)_θ| (IEC 60909-style; θ from the fault settings).
 * @param {Design} design @param {string} poleId
 */
export function explainFault(design, poleId) {
  const s = faultSettings(design);
  const txId = /** @type {string} */ (transformerOfPole(design, poleId));
  const tx = /** @type {any} */ (design.transformers.find(t => t.id === txId));
  const zq = sourceImpedance(design, s);
  const t = txImpedance(tx, design);
  const zT = { re: t.r, im: t.x };
  const kT = 1 + ALPHA_AL_PER_K * (s.condTempC - 20);
  const steps = [
    step('HV source (referred to LV)', 'Zq = c_max·U_LL² / S"k  (X/R from the settings)', s.hvFaultMVA ? `${s.cMax} × (√3·${design.vnom} V)² / ${s.hvFaultMVA} MVA, X/R ${s.hvXR}` : 'S"k not set → infinite bus, Zq = 0', zq, 'Ω'),
    step('Transformer', 'Z_T = z% · U² / S_rated, split by X/R', `${tx.txRating} kVA, X/R ${tx.txXR}`, zT, 'Ω')
  ];
  let zMax = C.add(zq, zT), zLoop = C.add(zq, zT);
  pathTo(design, poleId).forEach(id => {
    const p = /** @type {any} */ (poleById(design, id)), cp = conductorParams(design, p.cond), km = (Number(p.spanM) || 0) / 1000;
    const zp = { re: cp.R * km, im: cp.X * km };
    const zl = { re: (cp.R + cp.Rn) * kT * km, im: (cp.X + cp.Xn) * km };
    steps.push(step(`Span into ${id}: phase (20 °C)`, 'Z_ph = (R + jX)·L', `(${f(cp.R, 4)} + j${f(cp.X, 4)}) × ${f(km, 3)} km`, zp, 'Ω'));
    steps.push(step(`Span into ${id}: loop at ${s.condTempC} °C`, 'Z_loop = ((R + Rn)·k_θ + j(X + Xn))·L', `((${f(cp.R, 4)} + ${f(cp.Rn, 4)}) × ${f(kT, 4)} + j(${f(cp.X, 4)} + ${f(cp.Xn, 4)})) × ${f(km, 3)} km`, zl, 'Ω'));
    zMax = C.add(zMax, zp); zLoop = C.add(zLoop, zl);
  });
  const ik3 = s.cMax * design.vnom / C.abs(zMax), ik1 = s.cMin * design.vnom / C.abs(zLoop);
  steps.push(step('Ik3max', 'Ik3max = c_max · U_LN / |Zq + Z_T + ΣZ_ph|', `${s.cMax} × ${design.vnom} V / ${f(C.abs(zMax), 4)} Ω`, ik3, 'A'));
  steps.push(step('Ik1min', 'Ik1min = c_min · U_LN / |Zq + Z_T + ΣZ_loop|', `${s.cMin} × ${design.vnom} V / ${f(C.abs(zLoop), 4)} Ω`, ik1, 'A'));
  return {
    kind: 'fault', title: `Fault current at ${poleId}`, steps,
    result: { label: 'Ik1min (the figure protection must clear)', value: ik1, unit: 'A' },
    notes: [`k_θ = 1 + α(θ − 20 °C) = 1 + ${ALPHA_AL_PER_K} × (${s.condTempC} − 20) = ${f(kT, 4)} (aluminium).`, 'The transformer is taken at its positive-sequence impedance in the loop (a common LV simplification for Dyn transformers).']
  };
}

/** VUF from symmetrical components of the pole's phase voltages. @param {SnapshotResult} res @param {string} poleId */
export function explainVuf(res, poleId) {
  const pr = /** @type {any} */ (res.poleResults.find(x => x.id === poleId));
  const a = C.fromPolar(1, 120), a2 = C.fromPolar(1, 240);
  const { A: Va, B: Vb, C: Vc } = pr.vph;
  const third = (z) => C.mulS(z, 1 / 3);
  const V1 = third(C.add(C.add(Va, C.mul(a, Vb)), C.mul(a2, Vc)));
  const V2 = third(C.add(C.add(Va, C.mul(a2, Vb)), C.mul(a, Vc)));
  const V0 = third(C.add(C.add(Va, Vb), Vc));
  const steps = [
    step('Phase voltages', 'Va, Vb, Vc (phase-to-neutral phasors)', `${polar(Va)}, ${polar(Vb)}, ${polar(Vc)} V`, null),
    step('Positive sequence', 'V1 = (Va + a·Vb + a²·Vc) / 3, a = 1∠120°', polar(V1) + ' V', V1, 'V'),
    step('Negative sequence', 'V2 = (Va + a²·Vb + a·Vc) / 3', polar(V2) + ' V', V2, 'V'),
    step('Zero sequence', 'V0 = (Va + Vb + Vc) / 3', polar(V0) + ' V', V0, 'V')
  ];
  return {
    kind: 'vuf', title: `Voltage unbalance at ${poleId}`, steps,
    result: { label: `VUF = |V2| / |V1| × 100 = ${f(C.abs(V2), 3)} / ${f(C.abs(V1), 2)} × 100`, value: C.abs(V2) / C.abs(V1) * 100, unit: '%' },
    check: { label: 'Reported', value: pr.vufPct, unit: '%' },
    notes: [`Limit ${res.vufLimitPct} % (standards profile).`]
  };
}

/** The hosting search as a trace (from traceHostingSearch). @param {any} t */
export function explainHosting(t) {
  const why = (fl) => (!fl ? 'passes' : fl.reason === 'violation' ? `fails: ${fl.detail.type} at ${fl.detail.pole} ${fl.detail.phase}, ${String(fl.detail.hour).padStart(2, '0')}:00${fl.detail.worsened ? ' (made worse)' : ''}` : fl.reason === 'collapse' ? `fails: voltage collapse at ${String(fl.detail.hour).padStart(2, '0')}:00` : `fails: no convergence at ${String(fl.detail.hour).padStart(2, '0')}:00`);
  const steps = t.trace.map((s, i) => step(`Try ${i + 1}`, i === 0 ? 'the cap first' : 'bisection, then one 0.05 kVA step up', `${f(s.kva, 3)} kVA`, s.kva, why(s.failure)));
  return {
    kind: 'hosting', title: `Hosting search at ${t.pole} phase ${t.phase}`, steps,
    result: { label: `Largest passing size (floored to 0.05 kVA)${t.result.limit === 'cap' ? ' — the cap itself passes' : ''}`, value: t.result.kva, unit: 'kVA' },
    notes: [`Each try solves ${t.testHours.length} hours (${t.testHours.map(h => String(h).padStart(2, '0') + ':00').join(', ')}). A size fails if it creates a new violation or worsens an existing one by more than 0.01.`,
      t.baselineViolations.length ? `The design already has ${t.baselineViolations.length} violation(s) at those hours; they don't count against the PV unless made worse.` : 'The design has no violations at those hours.']
  };
}
