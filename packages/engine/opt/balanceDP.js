// @ts-check
// Exact phase balancing for linear goals (O2.1), by dynamic programming.
//
// The goal is the legacy one — make the three per-phase totals as equal as possible — but solved
// exactly, for every move budget at once, instead of by one greedy pass:
//   - Totals are counted in integer units of `resolution` (0.5 kVA by default for nameplate kVA).
//     A state is (sumA, sumB); sumC = total − sumA − sumB is implied.
//   - Connections are added one at a time, each on A, B or C. Putting a connection on a phase
//     other than today's costs one move. For every reachable state only the fewest moves that
//     reach it are kept (with a back-pointer to rebuild the arrangement): the same totals reached
//     with more moves can never be better, so nothing optimal is pruned.
//   - At the end every state has its spread max − min and its minimum moves. For each budget k,
//     the best spread over states with ≤ k moves is the exact optimum for that budget — the
//     whole table comes from one pass.
// The state space is bounded by the number of distinct partial sums, not 3ⁿ arrangements: about
// 30 000 states on the fixture's 20 connections.
//
// Impedance-weighted goal: each connection counts kVA × |Z_path| / |Z_first span|, where Z_path
// is Σ (Zph + Zn) from the transformer to its pole — a far connection moves voltages more than the
// same kVA near the transformer. Weights are rounded to the resolution (default 0.05), so the
// answer is exact for the rounded weights; the true spread of any arrangement is within
// n × resolution / 2 of its rounded spread, which is reported as the error bound.
import { PHASES } from '../complex.js';
import { balanceableConnections } from '../advisors/phaseBalance.js';
import { pathImpedanceOhm } from '../advisors/phaseOptimiser.js';
import { conductorParams } from '../model.js';
import { optResult, nowMs, elapsedMs } from './result.js';
/** @import { Design, Phase } from '../types.js' */

export const DP_STATE_CAP = 2_000_000;

/** |Zph + Zn| of the first span out of the transformer (the smallest of its feeders' first spans). @param {Design} design @param {string} txId */
function firstSpanOhm(design, txId) {
  const roots = design.poles.filter(p => p.parent === txId);
  const z = roots.map(p => { const cp = conductorParams(design, p.cond), km = p.spanM / 1000; return Math.hypot((cp.R + cp.Rn) * km, (cp.X + cp.Xn) * km); }).filter(v => v > 0);
  return z.length ? Math.min(...z) : 1;
}

/**
 * @param {Design} design @param {string} txId
 * @param {{ objective?: 'nameplate' | 'impedanceWeighted', maxMoves?: number, resolution?: number, stateCap?: number }} [opts]
 */
export function balanceExactDP(design, txId, opts = {}) {
  const t0 = nowMs();
  const objective = opts.objective === 'impedanceWeighted' ? 'impedanceWeighted' : 'nameplate';
  const notes = [];
  const items = balanceableConnections(design, txId);
  const n = items.length;
  const maxMoves = Math.min(opts.maxMoves ?? n, n);
  const zFirst = objective === 'impedanceWeighted' ? firstSpanOhm(design, txId) : 1;
  const weights = items.map(it => (objective === 'impedanceWeighted' ? it.kva * pathImpedanceOhm(design, it.pole) / zFirst : it.kva));
  let resolution = opts.resolution ?? (objective === 'impedanceWeighted' ? 0.05 : 0.5);
  const stateCap = opts.stateCap ?? DP_STATE_CAP;

  for (;;) {
    const units = weights.map(w => Math.round(w / resolution));
    const exactUnits = weights.every((w, i) => Math.abs(units[i] * resolution - w) < 1e-9);
    const total = units.reduce((s, u) => s + u, 0);
    const W = total + 1;
    // layers[i]: state key → [moves, previous key, phase index chosen for item i − 1]
    /** @type {Map<number, [number, number, number]>[]} */
    const layers = [new Map([[0, [0, -1, -1]]])];
    let states = 1, overflow = false;
    for (let i = 0; i < n && !overflow; i++) {
      const next = new Map();
      const orig = PHASES.indexOf(items[i].phase), u = units[i];
      layers[i].forEach(([moves], key) => {
        const a = Math.floor(key / W), b = key % W;
        for (let ph = 0; ph < 3; ph++) {
          const m = moves + (ph === orig ? 0 : 1);
          if (m > maxMoves) continue;
          const k2 = (a + (ph === 0 ? u : 0)) * W + (b + (ph === 1 ? u : 0));
          const have = next.get(k2);
          if (!have || m < have[0]) next.set(k2, [m, key, ph]);
        }
      });
      layers.push(next);
      states += next.size;
      if (states > stateCap) overflow = true;
    }
    if (overflow) {
      notes.push(`More than ${stateCap.toLocaleString('en')} states at ${resolution} resolution — retried at ${resolution * 2}.`);
      resolution *= 2;
      continue;
    }
    // Best state per move budget.
    const final = layers[n];
    /** @type {{ spreadU: number, key: number }[]} best for exactly m moves */
    const byMoves = Array.from({ length: maxMoves + 1 }, () => ({ spreadU: Infinity, key: -1 }));
    final.forEach(([m], key) => {
      const a = Math.floor(key / W), b = key % W, c = total - a - b;
      const s = Math.max(a, b, c) - Math.min(a, b, c);
      if (s < byMoves[m].spreadU) byMoves[m] = { spreadU: s, key };
    });
    /** @param {number} key @returns {Phase[]} */
    const rebuild = (key) => {
      const arr = /** @type {Phase[]} */ (Array(n));
      for (let i = n; i > 0; i--) { const [, prev, ph] = /** @type {[number, number, number]} */ (layers[i].get(key)); arr[i - 1] = PHASES[ph]; key = prev; }
      return arr;
    };
    const totalsOf = (/** @type {Phase[]} */ arr, /** @type {number[]} */ w) => { const t = { A: 0, B: 0, C: 0 }; arr.forEach((ph, i) => { t[ph] += w[i]; }); return t; };
    const spreadOf = (/** @type {{ A: number, B: number, C: number }} */ t) => Math.max(t.A, t.B, t.C) - Math.min(t.A, t.B, t.C);
    const table = [];
    let best = { spreadU: Infinity, key: -1, m: 0 };
    for (let k = 0; k <= maxMoves; k++) {
      if (byMoves[k].spreadU < best.spreadU) best = { ...byMoves[k], m: k };
      if (best.key < 0) { table.push({ k, spread: null, moves: null, changed: [], totals: null }); continue; }
      const arr = rebuild(best.key);
      const changed = items.map((it, i) => ({ ...it, newPhase: arr[i] })).filter(c => c.newPhase !== c.phase);
      table.push({ k, spread: best.spreadU * resolution, trueSpread: spreadOf(totalsOf(arr, weights)), moves: changed.length, changed, totals: totalsOf(arr, weights), kvaTotals: totalsOf(arr, items.map(it => it.kva)) });
    }
    const errorBound = exactUnits ? 0 : n * resolution / 2;
    if (!exactUnits) notes.push(`Weights rounded to ${resolution}: each spread is exact for the rounded weights and within ${errorBound.toFixed(3)} of the true spread.`);
    const globalBest = table[table.length - 1];
    return {
      objective, resolution, states, items: items.map((it, i) => ({ ...it, weight: weights[i] })), table,
      errorBound,
      ...optResult({
        method: objective === 'impedanceWeighted' ? 'Exact DP (impedance-weighted kVA)' : 'Exact DP (nameplate kVA)',
        certificate: 'exact', objective: globalBest.spread, evaluations: states, ms: elapsedMs(t0),
        solution: globalBest, verified: false,
        notes: [...notes, 'A linear balancing goal — the arrangement is not load-flow checked here; preview it to see voltages.']
      })
    };
  }
}
