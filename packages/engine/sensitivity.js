// @ts-check
// Voltage sensitivity matrix (P4.2): ∂|V|/∂P and ∂|V|/∂Q of every pole-phase voltage with respect
// to a power injection at every pole-phase, by central finite differences: two perturbed load
// flows (±deltaKw, default 0.5 kW, and the same in kvar) per injection point and quantity.
//
// It linearises the network at one operating point (year, hour, multipliers), so it is good for
// small changes: instant what-if previews while dragging a customer to another phase (P5.2), and
// a first estimate of hosting capacity. Every decision is still confirmed by a full load flow.
// Smart inverters, ZIP loads and SOC-BESS dispatch are held at their base-case behaviour by the
// linearisation (the dispatch is frozen, the others respond inside each perturbed solve), so
// predictions far from the operating point drift. That is why they are only previews.
//
// Signs: P and Q are injections (generation positive). A positive ∂|V|/∂P means exporting there
// raises that voltage. Units V per kW and V per kvar.
// Cross-transformer terms are exactly zero (separate networks), so the result is one block per
// transformer, each solved on that transformer's own sub-design.
import { PHASES } from './complex.js';
import { transformerSubDesign } from './model.js';
import { connectionIndex, netS } from './loads.js';
import { runSnapshot, topologyOf, warmStartFrom } from './solver.js';
import { simulateBessDay, socBessUnits } from './bessDispatch.js';
/** @import { Design, Phase, ProgressHooks, SnapshotResult } from './types.js' */
/** @typedef {{ pole: string, phase: Phase }} SensNode */
/**
 * @typedef {object} SensitivityBlock
 * @property {string} txId
 * @property {SensNode[]} nodes          Injection and observation points, in the same order.
 * @property {number[]} baseV            |V| at each node in the base case, V.
 * @property {number[][]} dVdP           [injection i][observed k], V/kW.
 * @property {number[][]} dVdQ           [injection i][observed k], V/kvar.
 * @property {number} vLimLow
 * @property {number} vLimHigh
 * @property {boolean} converged         The base and every perturbed solve converged.
 */

export const SENSITIVITY_DELTA_KW = 0.5;

/**
 * @param {Design} design
 * @param {{ year?: number, hour?: number, loadMult?: number, solarMult?: number, deltaKw?: number, txIds?: string[] } & ProgressHooks} [opts]
 * @returns {{ year: number, hour: number, loadMult: number, solarMult: number, deltaKw: number, blocks: SensitivityBlock[] }}
 */
export function voltageSensitivity(design, opts = {}) {
  const { year = 0, hour = 20, loadMult = 1, solarMult = 1, deltaKw = SENSITIVITY_DELTA_KW, txIds, onProgress } = opts;
  // SOC-aware BESS: the day is simulated up to this hour once, and that dispatch is held fixed in
  // every perturbed solve (a small injection change would not re-plan the batteries).
  const day = socBessUnits(design).length ? simulateBessDay(design, year, { loadMult, solarMult, lastHour: hour }) : null;
  const bessDispatch = day ? Object.fromEntries(day[hour].bess.map(b => [b.id, b.pKw])) : null;
  const base = { year, hour, loadMult, solarMult, bessDispatch };

  const txs = design.transformers.filter(t => !txIds || txIds.includes(t.id));
  const total = txs.reduce((s, t) => s + transformerSubDesign(design, t.id).poles.length * PHASES.length * 4, 0);
  let done = 0;
  const blocks = txs.map(tx => {
    const sub = transformerSubDesign(design, tx.id);
    const ctx = { index: connectionIndex(sub), topo: topologyOf(sub) };
    const res0 = runSnapshot(sub, base, ctx);
    /** @type {SensNode[]} */
    const nodes = res0.poleResults.flatMap(pr => PHASES.map(ph => ({ pole: pr.id, phase: ph })));
    /** @param {SnapshotResult} r */
    const voltages = (r) => r.poleResults.flatMap(pr => PHASES.map(ph => pr.volt[ph]));
    const baseV = voltages(res0);
    const initialV = warmStartFrom(res0);
    let converged = res0.converged;
    // Load convention in extraS: an injection of +x kW is a load of −x kW.
    /** @param {SensNode} n @param {number} p @param {number} q */
    const solve = (n, p, q) => {
      const r = runSnapshot(sub, { ...base, extraS: [{ pole: n.pole, phase: n.phase, p, q }] }, { ...ctx, initialV });
      converged = converged && r.converged;
      if (onProgress) onProgress({ stage: `Sensitivities, ${tx.name || tx.id}`, done: ++done, total });
      return voltages(r);
    };
    const dVdP = [], dVdQ = [];
    for (const n of nodes) {
      const pUp = solve(n, -deltaKw, 0), pDown = solve(n, deltaKw, 0);
      const qUp = solve(n, 0, -deltaKw), qDown = solve(n, 0, deltaKw);
      dVdP.push(pUp.map((v, k) => (v - pDown[k]) / (2 * deltaKw)));
      dVdQ.push(qUp.map((v, k) => (v - qDown[k]) / (2 * deltaKw)));
    }
    return { txId: tx.id, nodes, baseV, dVdP, dVdQ, vLimLow: res0.vLimLow, vLimHigh: res0.vLimHigh, converged };
  });
  return { year, hour, loadMult, solarMult, deltaKw, blocks };
}

/** @param {SensitivityBlock} b @param {string} pole @param {Phase} phase */
function nodeIndex(b, pole, phase) { return b.nodes.findIndex(n => n.pole === pole && n.phase === phase); }

/**
 * Linear prediction of every |V| after the given injection changes (kW / kvar, generation
 * positive): V ≈ V0 + Σ dV/dP·ΔP + dV/dQ·ΔQ. A 3-phase change ('ABC') is split into thirds.
 * @param {ReturnType<typeof voltageSensitivity>} sens
 * @param {{ pole: string, phase: Phase | 'ABC', dP?: number, dQ?: number }[]} changes
 * @returns {Record<string, Record<Phase, number>>} pole → phase → predicted |V|, V
 */
export function predictVoltages(sens, changes) {
  /** @type {Record<string, Record<Phase, number>>} */
  const out = {};
  sens.blocks.forEach(b => {
    const v = b.baseV.slice();
    changes.forEach(c => {
      const parts = c.phase === 'ABC' ? PHASES.map(ph => ({ ph, f: 1 / 3 })) : [{ ph: c.phase, f: 1 }];
      parts.forEach(({ ph, f }) => {
        const i = nodeIndex(b, c.pole, ph);
        if (i < 0) return;
        for (let k = 0; k < v.length; k++) v[k] += b.dVdP[i][k] * (c.dP || 0) * f + b.dVdQ[i][k] * (c.dQ || 0) * f;
      });
    });
    b.nodes.forEach((n, k) => { (out[n.pole] = out[n.pole] || /** @type {any} */ ({}))[n.phase] = v[k]; });
  });
  return out;
}

/**
 * Injection changes for moving a connection that draws pKw + j·qKvar (load convention; negative
 * for generation) from one phase to another at the same pole.
 * @param {{ pole: string, from: Phase, to: Phase, pKw: number, qKvar?: number }} move
 */
export function phaseMoveChanges(move) {
  const q = move.qKvar || 0;
  return [
    { pole: move.pole, phase: move.from, dP: move.pKw, dQ: q },   // its demand leaves `from`
    { pole: move.pole, phase: move.to, dP: -move.pKw, dQ: -q }    // and appears on `to`
  ];
}

/**
 * What one connection draws at an operating point: P + jQ, kW / kvar, load convention (negative
 * for generation), exactly as netS would inject it (curves, growth, multipliers, pf, RTE). A
 * smart-inverter PV unit counts at its available power (its volt-var response is left to the
 * confirming load flow), and an SOC-mode BESS as idle (its dispatch belongs to the day
 * simulation). Feeds phaseMoveChanges for drag-to-rephase previews (P5.2).
 * @param {Design} design @param {'load' | 'pv' | 'bess'} kind @param {string} id
 * @param {{ year?: number, hour?: number, loadMult?: number, solarMult?: number }} [op]
 * @returns {{ pKw: number, qKvar: number }}
 */
export function connectionPowerAt(design, kind, id, op = {}) {
  const { year = 0, hour = 20, loadMult = 1, solarMult = 1 } = op;
  /** @type {any[]} */
  const list = kind === 'load' ? design.loads : kind === 'pv' ? design.pv : design.bess;
  const c = list.find(x => x.id === id);
  if (!c) return { pKw: 0, qKvar: 0 };
  /** @type {Design} */
  const only = { ...design, loads: kind === 'load' ? [c] : [], pv: kind === 'pv' ? [c] : [], bess: kind === 'bess' ? [c] : [] };
  const s = netS(only, c.pole, year, hour, loadMult, solarMult, [], [], undefined, null);
  let p = 0, q = 0;
  PHASES.forEach(ph => { p += s.loadS[ph].re + s.otherS[ph].re; q += s.loadS[ph].im + s.otherS[ph].im; });
  s.smart.forEach(u => { p -= u.pAvail; });
  return { pKw: p, qKvar: q };
}

/**
 * First estimate of the unity-pf PV (kW) a pole-phase can take before any voltage leaves the band
 * (voltage limits only, linear). A starting point for the hosting search, which confirms it with
 * full load flows. Infinity when no voltage moves towards a limit.
 * @param {ReturnType<typeof voltageSensitivity>} sens @param {string} pole @param {Phase} phase
 * @returns {{ kw: number, limitPole: string | null, limitPhase: Phase | null, limit: 'high' | 'low' | null }}
 */
export function linearHostingEstimateKw(sens, pole, phase) {
  for (const b of sens.blocks) {
    const i = nodeIndex(b, pole, phase);
    if (i < 0) continue;
    /** @type {{ kw: number, limitPole: string | null, limitPhase: Phase | null, limit: 'high' | 'low' | null }} */
    let best = { kw: Infinity, limitPole: null, limitPhase: null, limit: null };
    b.nodes.forEach((n, k) => {
      const s = b.dVdP[i][k], v0 = b.baseV[k];
      const kw = s > 1e-9 ? (b.vLimHigh - v0) / s : s < -1e-9 ? (v0 - b.vLimLow) / -s : Infinity;
      if (kw < best.kw) best = { kw: Math.max(0, kw), limitPole: n.pole, limitPhase: n.phase, limit: s > 0 ? 'high' : 'low' };
    });
    return best;
  }
  return { kw: Infinity, limitPole: null, limitPhase: null, limit: null };
}
