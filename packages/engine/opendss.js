// @ts-check
// OpenDSS export (P7.6): the design at one snapshot as an OpenDSS script, built to be the *same
// model* the app solves, so the two can be cross-checked (scripts/validate-opendss.py):
//   - each transformer is an ideal 3-phase source behind its series impedance with its LV star
//     point earthed, which is what a Dyn transformer fed from a stiff HV bus is. In OpenDSS: a very
//     stiff Vsource on an HV bus, a delta–wye Transformer with no magnetising branch or no-load
//     loss, its %R/%X set so the LV-referred impedance is exactly txImpedance(), and its turns ratio
//     set so the LV open-circuit voltage is exactly the app's V0 (tap and HV profile included);
//   - every span is a 4-wire Line (phases A, B, C on nodes 1–3, neutral on node 4, no Kron
//     reduction, no shunt capacitance — the app has none), from a LineCode per conductor: diagonal
//     R/X and Rn/Xn for the simple model, or the conductor's 4×4 zMatrix when the design uses the
//     coupled model (only outside earthed subtrees, as in the app — lineModel.js);
//   - earth electrodes (the transformer's star point and any earthed pole) are resistors to node 0;
//   - per pole and phase, the load (constant power, or ZIP with the design's coefficients) is one
//     single-phase Load between the phase and that pole's neutral, and everything that doesn't
//     depend on voltage in the app (PV at unity pf, BESS, test injections) is a second, constant
//     power Load — negative for generation. Smart-inverter PV (volt-var, volt-watt, export limit)
//     and SOC-scheduled BESS are exported at the P and Q the app solved for this snapshot: OpenDSS
//     would need its own InvControl/Storage settings to reproduce them, and those are not the same
//     controller, so a fixed operating point keeps the comparison about the network solution.
// Spans of 0 m (a transformer bolted to a pole) get a 1 cm length: OpenDSS cannot take a 0-length
// line, and the app already floors the neutral of such spans to 1 cm (solver.js).
import { PHASES, PHASE_ANGLE } from './complex.js';
import { conductorParams, getConductor, secondaryLNVoltage, txImpedance, hvMultiplierAt } from './model.js';
import { netS, connectionIndex } from './loads.js';
import { couplingMatrix, diagonalZMatrix } from './lineModel.js';
import { runSnapshotAt } from './scan.js';
/** @import { Design, SnapshotOptions, SnapshotResult } from './types.js' */

const NODE = { A: 1, B: 2, C: 3 };
// The HV side's nominal voltage only sets the turns ratio's numerator; the app models the
// transformer from its LV side, so any value gives the same LV result. 11 kV is the usual one.
const HV_KV = 11;
const fmt = (/** @type {number} */ x) => (Math.abs(x) < 1e-15 ? '0' : Number(x.toPrecision(12)).toString());

/** A name OpenDSS accepts (letters, digits, underscore), unique within `used`. @param {string} prefix @param {string} id @param {Set<string>} used */
function dssName(prefix, id, used) {
  const base = `${prefix}_${String(id).toLowerCase().replace(/[^a-z0-9_]/g, '_')}`;
  let name = base, n = 2;
  while (used.has(name)) name = `${base}_${n++}`;
  used.add(name);
  return name;
}

/** Lower triangle of a 4×4 matrix in OpenDSS's "a | b c | d e f | …" form. @param {number[][]} m */
const lowerTriangle = (m) => '[' + m.map((row, i) => row.slice(0, i + 1).map(fmt).join(' ')).join(' | ') + ']';

/**
 * The design at one snapshot as an OpenDSS script, with the bus names used for each pole and
 * transformer (so a comparison can find them).
 * @param {Design} design
 * @param {SnapshotOptions & { result?: SnapshotResult }} opts the snapshot (year, hour, multipliers, …);
 *   `result` is the app's solved snapshot (for smart-inverter and SOC-BESS operating points) — solved
 *   here when omitted.
 * @returns {{ script: string, buses: { poles: Record<string, string>, transformers: Record<string, string> }, notes: string[] }}
 */
export function toOpenDSS(design, opts) {
  const { year, hour, loadMult = 1, solarMult = 1, extraPV = [], extraBess = [], extraS = [] } = opts;
  const res = opts.result || runSnapshotAt(design, { year, hour, loadMult, solarMult, extraPV, extraBess, extraS });
  const notes = [];
  /** @type {Record<string, number>} */
  const bessDispatch = {};
  (/** @type {any} */ (res).bess || []).forEach((/** @type {any} */ b) => { bessDispatch[b.id] = b.pKw; });
  const index = connectionIndex(design);
  const used = new Set();
  const out = [];
  const say = (/** @type {string} */ s) => out.push(s);

  say(`! ${design.name || 'Design'} — exported by Feeder Island for year ${year}, ${String(hour).padStart(2, '0')}:00, load ×${loadMult}, solar ×${solarMult}`);
  say('! Same model as the app: ideal source behind the transformer impedance, uncoupled (or the');
  say('! design\'s coupled) 4-wire spans, constant-power loads. Voltages are phase-to-local-neutral.');
  say('Clear');

  const poleBus = /** @type {Record<string, string>} */ ({});
  const txBus = /** @type {Record<string, string>} */ ({});
  design.transformers.forEach(tx => { txBus[tx.id] = dssName('tx', tx.id, used); });
  design.poles.forEach(p => { poleBus[p.id] = dssName('p', p.id, used); });
  const poleById = new Map(design.poles.map(p => [p.id, p]));
  const txOfPole = (/** @type {string} */ id) => { let p = poleById.get(id), guard = 0; while (p && poleById.has(p.parent) && guard++ < 1e5) p = poleById.get(p.parent); return p ? p.parent : null; };
  const earthedTx = new Set(design.poles.filter(p => p.grounded && Number(p.groundOhms) > 0).map(p => txOfPole(p.id)));

  design.transformers.forEach((tx, i) => {
    const V0 = secondaryLNVoltage(tx) * hvMultiplierAt(tx, hour);
    const kvLL = V0 * Math.sqrt(3) / 1000;
    const z = txImpedance(tx, design);
    const zbase = kvLL * kvLL / (tx.txRating / 1000);
    const pctR = 100 * z.r / zbase, pctX = 100 * z.x / zbase;
    const hv = dssName('hv', tx.id, used);
    // Dyn11: the LV side leads the HV by 30°, so the HV source sits at −30° and LV phase A at 0°,
    // as in the app (PHASE_ANGLE). A stiff source (µΩ) so the transformer is the only impedance.
    const src = `bus1=${hv} basekv=${HV_KV} pu=1 angle=${fmt(PHASE_ANGLE.A - 30)} phases=3 Z1=[1e-6 1e-6] Z0=[1e-6 1e-6]`;
    say('');
    say(`! Transformer ${tx.id}: ${tx.txRating} kVA, V0 = ${fmt(V0)} V phase-neutral, Z = ${fmt(z.r)} + j${fmt(z.x)} Ω per phase (LV)`);
    say(i === 0 ? `New Circuit.feeder_island ${src}` : `New Vsource.${dssName('src', tx.id, used)} ${src}`);
    say(`New Transformer.${dssName('t', tx.id, used)} phases=3 windings=2 buses=[${hv}.1.2.3 ${txBus[tx.id]}.1.2.3.4] conns=[delta wye] kVs=[${HV_KV} ${fmt(kvLL)}] kVAs=[${tx.txRating} ${tx.txRating}] %Rs=[${fmt(pctR / 2)} ${fmt(pctR / 2)}] XHL=${fmt(pctX)} %noloadloss=0 %imag=0 LeadLag=Lead`);
    say(`New Reactor.${dssName('rg', tx.id, used)} phases=1 bus1=${txBus[tx.id]}.4 bus2=${txBus[tx.id]}.0 R=${fmt(Number(tx.txGroundOhms) || 7.5)} X=0`);
  });

  // Line codes: one per conductor (and model) in use, each written just before its first line.
  const codes = new Map();
  const lineCode = (/** @type {string} */ cond, /** @type {boolean} */ coupledOk) => {
    const zm = coupledOk ? couplingMatrix(design, getConductor(design, cond)) : null;
    const key = (zm ? 'm_' : 's_') + cond;
    if (codes.has(key)) return codes.get(key);
    const name = dssName(zm ? 'lcm' : 'lc', cond, used);
    codes.set(key, name);
    const cp = conductorParams(design, cond);
    const m = zm || diagonalZMatrix(cp);
    const R = m.map(row => row.map(v => v.re)), X = m.map(row => row.map(v => v.im));
    if (zm && m.some((row, a) => row.some((v, b) => Math.abs(v.re - m[b][a].re) > 1e-12 || Math.abs(v.im - m[b][a].im) > 1e-12))) notes.push(`Conductor ${cond}: its zMatrix isn't symmetric; OpenDSS takes the lower triangle.`);
    say(`New LineCode.${name} nphases=4 units=km rmatrix=${lowerTriangle(R)} xmatrix=${lowerTriangle(X)} cmatrix=[0 | 0 0 | 0 0 0 | 0 0 0 0] Kron=No`);
    return name;
  };

  say('');
  design.poles.forEach(p => {
    const from = poleById.has(p.parent) ? poleBus[p.parent] : txBus[p.parent];
    if (!from) { notes.push(`Pole ${p.id}: its parent "${p.parent}" is neither a pole nor a transformer — left out.`); return; }
    const km = Math.max(Number(p.spanM) / 1000, 1e-5);
    const code = lineCode(p.cond, !earthedTx.has(txOfPole(p.id)));
    say(`New Line.${dssName('l', p.id, used)} bus1=${from}.1.2.3.4 bus2=${poleBus[p.id]}.1.2.3.4 phases=4 linecode=${code} length=${fmt(km)} units=km`);
    if (p.grounded && Number(p.groundOhms) > 0) say(`New Reactor.${dssName('rg', p.id, used)} phases=1 bus1=${poleBus[p.id]}.4 bus2=${poleBus[p.id]}.0 R=${fmt(Number(p.groundOhms))} X=0`);
  });

  // Loads and injections, per pole and phase.
  say('');
  const zip = design.loadModel === 'zip';
  const kvLN = design.vnom / 1000;
  const loadModel = zip
    ? `model=8 ZIPV=[${[design.zipZ ?? 0, design.zipI ?? 0, design.zipP ?? 1, design.zipZ ?? 0, design.zipI ?? 0, design.zipP ?? 1].map(fmt).join(' ')} 0]`
    : 'model=1';
  // Constant power down to 0.1 pu (OpenDSS's default switches to constant impedance below 0.95 pu).
  const band = 'vminpu=0.1 vmaxpu=2 vlowpu=0.05';
  const resByPole = new Map(res.poleResults.map(r => [r.id, r]));
  let smartUnits = 0;
  design.poles.forEach(p => {
    const inj = netS(design, p.id, year, hour, loadMult, solarMult, extraPV, extraBess, index, bessDispatch);
    const other = { A: { ...inj.otherS.A }, B: { ...inj.otherS.B }, C: { ...inj.otherS.C } };
    extraS.filter(x => x.pole === p.id).forEach(x => { other[x.phase].re += x.p; other[x.phase].im += x.q; });
    const pr = resByPole.get(p.id);
    (pr ? pr.inverters : []).forEach(u => { other[u.phase].re -= u.pKw; other[u.phase].im -= u.qKvar; smartUnits++; });
    PHASES.forEach(ph => {
      const bus = `${poleBus[p.id]}.${NODE[ph]}.4`;
      const s = inj.loadS[ph], o = other[ph];
      if (s.re !== 0 || s.im !== 0) say(`New Load.${dssName('ld', `${p.id}_${ph}`, used)} phases=1 bus1=${bus} kV=${fmt(kvLN)} kW=${fmt(s.re)} kvar=${fmt(s.im)} ${loadModel} ${band}`);
      if (o.re !== 0 || o.im !== 0) say(`New Load.${dssName('inj', `${p.id}_${ph}`, used)} phases=1 bus1=${bus} kV=${fmt(kvLN)} kW=${fmt(o.re)} kvar=${fmt(o.im)} model=1 ${band}`);
    });
  });
  if (smartUnits) notes.push(`${smartUnits} smart-inverter PV unit(s) exported at the P and Q the app solved for this hour.`);
  if (Object.keys(bessDispatch).length) notes.push('SOC-scheduled BESS exported at the app\'s dispatch for this hour.');
  if (res.status !== 'converged') notes.push(`The app's own solution for this snapshot is "${res.status}" — compare with care.`);

  say('');
  say('Set mode=snapshot maxiterations=200 tolerance=1e-8');
  say('Solve');
  notes.forEach(n => say(`! Note: ${n}`));
  return { script: out.join('\n') + '\n', buses: { poles: poleBus, transformers: txBus }, notes };
}
