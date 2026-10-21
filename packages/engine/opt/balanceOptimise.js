// @ts-check
// Phase balancing on the real goal (O2.2): full load flows over the chosen years and hours,
// compared lexicographically (smaller is better):
//   1. voltage violation-hours (all years)        2. thermal + transformer violation-hours
//   3. VUF violation-hours (only when the standards count VUF)
//   4. network loss over the day at the first year (kWh)     5. number of moves
// A move puts one connection on a different phase from today. Identical connections (same kind,
// pole, type, size) are interchangeable, so an arrangement is identified by how many of each
// group sit on each phase, and its move count is the fewest re-terminations that reach it.
//
// Method:
//   - Exact levels. Breadth-first by number of moves: level k is every distinct arrangement
//     exactly k moves from today, built from level k − 1 by one more move. While a level has at
//     most `exactCap` designs it is solved in full, and the best answer within that budget is
//     certified exact. On the fixture levels 1–3 are 20, 174 and 874 designs.
//   - Beyond the cap: simulated annealing with a tabu list, multi-start. Neighbours move one
//     connection to another phase or swap two connections on different phases; anything over the
//     move budget is rejected. The connections just changed are tabu for TABU_TENURE steps unless
//     the move beats the best found (aspiration). Metropolis acceptance on a scalarised objective
//     (VIOLATION_WEIGHT kWh per violation-hour, so violations always dominate loss), geometric
//     cooling from a start temperature at which ~80 % of worsening moves are accepted down to a
//     thousandth of it over the evaluation budget. Starts: today, the legacy greedy, the exact-DP
//     arrangement for the budget, the best exhaustive answers, then seeded random arrangements.
//     `restartsFoundBest` counts the restarts that reached the best answer; certificate
//     'heuristic'.
//   - Every evaluated design goes into a Pareto archive over (moves, violations, loss). The
//     recommendation is the fewest moves with zero violations; the table also shows the best
//     loss within one and two more moves.
// Every arrangement reported has passed full load flows with converged === true.
import { PHASES } from '../complex.js';
import { transformerSubDesign } from '../model.js';
import { DAILY_HOURS } from '../scan.js';
import { standardsOf } from '../standards.js';
import { balanceableConnections, proposePhaseBalance, applyPhaseBalance } from '../advisors/phaseBalance.js';
import { evaluateDesign, compareLex } from './evaluate.js';
import { createParetoArchive } from './pareto.js';
import { balanceExactDP } from './balanceDP.js';
import { rngFor, randInt } from './prng.js';
import { optResult, nowMs, elapsedMs } from './result.js';
/** @import { Design, Phase, ProgressHooks } from '../types.js' */

export const VIOLATION_WEIGHT = 1000;
const TABU_TENURE = 6;

/**
 * @param {Design} design @param {string} txId
 * @param {{ years?: number[], hours?: number[], solarMult?: number, maxMoves?: number, exactCap?: number, exact?: boolean, restarts?: number,
 *   budget?: number, seed?: number } & ProgressHooks} [opts]
 */
export function balanceOptimise(design, txId, opts = {}) {
  const t0 = nowMs();
  const years = opts.years && opts.years.length ? opts.years : [0, 5];
  const hours = opts.hours && opts.hours.length ? opts.hours : DAILY_HOURS;
  const solarMult = opts.solarMult ?? 1;
  const maxMoves = Math.max(0, Math.floor(opts.maxMoves ?? 3));
  const exactCap = opts.exactCap ?? 5000;
  const restarts = Math.max(0, Math.floor(opts.restarts ?? 20));
  const budget = Math.max(1, Math.floor(opts.budget ?? 3000));
  const seed = opts.seed ?? 1;
  const progress = opts.onProgress || (() => {});
  // The neighbour sampler has its own seeded stream, so the start list and the walk don't share
  // draws in an order-dependent way.
  const neighbourRand = rngFor(seed * 7919 + 13);
  const countVuf = standardsOf(design).vufAsViolation;
  const sub = transformerSubDesign(design, txId);
  const items = balanceableConnections(sub, txId);
  const n = items.length;
  const orig = /** @type {Phase[]} */ (items.map(it => it.phase));
  const notes = [];
  if (design.transformers.length > 1) notes.push(`Load flows of ${txId}'s own network only: other transformers are unaffected by its phases.`);

  // Interchangeable groups: same kind and every field but id and phase.
  const listOf = (/** @type {string} */ kind) => /** @type {any[]} */ (kind === 'load' ? sub.loads : kind === 'pv' ? sub.pv : sub.bess);
  /** @type {Map<string, number[]>} */
  const groupMap = new Map();
  items.forEach((it, i) => {
    const { id: _id, phase: _p, ...rest } = listOf(it.kind).find(c => c.id === it.id);
    const sig = it.kind + '|' + JSON.stringify(rest, Object.keys(rest).sort());
    if (!groupMap.has(sig)) groupMap.set(sig, []);
    /** @type {number[]} */ (groupMap.get(sig)).push(i);
  });
  const groups = [...groupMap.values()];
  const origCount = groups.map(g => { const c = { A: 0, B: 0, C: 0 }; g.forEach(i => { c[orig[i]]++; }); return c; });
  /** Same group counts, fewest changes from today. @param {Phase[]} arr @returns {Phase[]} */
  const normalise = (arr) => {
    const out = /** @type {Phase[]} */ (arr.slice());
    groups.forEach(g => {
      if (g.length === 1) return;
      const need = { A: 0, B: 0, C: 0 };
      g.forEach(i => { need[arr[i]]++; });
      const free = [];
      g.forEach(i => { if (need[orig[i]] > 0) { out[i] = orig[i]; need[orig[i]]--; } else free.push(i); });
      PHASES.forEach(ph => { while (need[ph] > 0) { out[/** @type {number} */ (free.shift())] = ph; need[ph]--; } });
    });
    return out;
  };
  const keyOf = (/** @type {Phase[]} */ arr) => groups.map(g => { const c = { A: 0, B: 0, C: 0 }; g.forEach(i => { c[arr[i]]++; }); return `${c.A}.${c.B}.${c.C}`; }).join('|');
  const movesOf = (/** @type {Phase[]} */ arr) => groups.reduce((s, g, gi) => {
    const c = { A: 0, B: 0, C: 0 }; g.forEach(i => { c[arr[i]]++; });
    const o = origCount[gi];
    return s + g.length - Math.min(c.A, o.A) - Math.min(c.B, o.B) - Math.min(c.C, o.C);
  }, 0);
  const changesOf = (/** @type {Phase[]} */ arr) => items.map((it, i) => ({ ...it, newPhase: arr[i] })).filter(c => c.newPhase !== c.phase);

  // Evaluation, cached by arrangement.
  /** @typedef {{ key: string, arr: Phase[], moves: number, tuple: number[], scalar: number, feasible: boolean, ev: import('./evaluate.js').Evaluation }} Cand */
  /** @type {Map<string, Cand>} */
  const cache = new Map();
  let calls = 0;
  const archive = createParetoArchive();
  /** @param {Phase[]} raw @returns {Cand} */
  const evaluate = (raw) => {
    calls++;
    const arr = normalise(raw), key = keyOf(arr);
    let c = cache.get(key);
    if (c) return c;
    const ev = evaluateDesign(applyPhaseBalance(sub, changesOf(arr)), { years, hours, solarMult });
    const v = ev.violations, moves = movesOf(arr);
    // Non-convergence counts as the worst outcome: it is never reported as feasible.
    const bad = ev.converged ? 0 : 1e6;
    const tuple = [v.voltage + bad, v.thermal + v.transformer, countVuf ? v.vuf : 0, ev.lossKwh, moves];
    c = { key, arr, moves, tuple, scalar: VIOLATION_WEIGHT * (tuple[0] + tuple[1] + tuple[2]) + ev.lossKwh + 1e-6 * moves, feasible: ev.converged && ev.total === 0, ev };
    cache.set(key, c);
    archive.insert([moves, tuple[0] + tuple[1] + tuple[2], ev.lossKwh], c);
    return c;
  };
  const better = (/** @type {Cand} */ a, /** @type {Cand | null} */ b) => !b || compareLex(a.tuple, b.tuple) < 0;

  const today = evaluate(orig);
  // The legacy greedy, for comparison (outside the archive: it may need more moves than allowed).
  const quick = proposePhaseBalance(sub, txId);
  const quickArr = /** @type {Phase[]} */ (items.map(it => /** @type {any} */ (quick.items.find(q => q.id === it.id && q.kind === it.kind))?.newPhase || it.phase));
  const legacyEv = evaluateDesign(applyPhaseBalance(sub, quick.changed), { years, hours, solarMult });
  /** @type {(Cand | null)[]} best with exactly k moves */
  const bestAt = Array(maxMoves + 1).fill(null);
  bestAt[0] = today;
  const levels = [{ k: 0, distinct: 1, feasible: today.feasible ? 1 : 0, exact: true, best: today }];

  // Exact levels.
  let exactThrough = 0;
  if (opts.exact !== false) {
    /** @type {Map<string, Phase[]>} */
    let level = new Map([[today.key, today.arr]]);
    const seen = new Set([today.key]);
    for (let k = 1; k <= maxMoves; k++) {
      /** @type {Map<string, Phase[]>} */
      const next = new Map();
      let over = false;
      for (const arr of level.values()) {
        for (let i = 0; i < n && !over; i++) for (const ph of PHASES) {
          if (ph === arr[i]) continue;
          const nb = arr.slice(); nb[i] = ph;
          const norm = normalise(nb), key = keyOf(norm);
          if (seen.has(key) || movesOf(norm) !== k) continue;
          seen.add(key); next.set(key, norm);
          if (next.size > exactCap) { over = true; break; }
        }
        if (over) break;
      }
      if (over) { notes.push(`${k} moves: more than ${exactCap} distinct arrangements — searched by annealing instead of in full.`); break; }
      let feasible = 0, done = 0;
      /** @type {Cand | null} */
      let best = null;
      for (const arr of next.values()) {
        const c = evaluate(arr);
        if (c.feasible) feasible++;
        if (better(c, best)) best = c;
        if (++done % 10 === 0 || done === next.size) progress({ stage: `Exact search, ${k} move${k === 1 ? '' : 's'}`, done, total: next.size });
      }
      bestAt[k] = best;
      levels.push({ k, distinct: next.size, feasible, exact: true, best });
      exactThrough = k;
      level = next;
    }
  }

  // Annealing + tabu beyond the exact levels (or for every level when they are switched off).
  /** @type {{ found: number, of: number } | undefined} */
  let restartsFoundBest;
  if (exactThrough < maxMoves && restarts > 0 && n > 0) {
    const rand = rngFor(seed);
    /** @type {Phase[][]} */
    const starts = [orig];
    if (movesOf(normalise(quickArr)) <= maxMoves) starts.push(quickArr);
    const dp = balanceExactDP(sub, txId, { maxMoves });
    const dpRow = dp.table[Math.min(maxMoves, dp.table.length - 1)];
    if (dpRow && dpRow.changed) { const byId = new Map(dpRow.changed.map(c => /** @type {[string, Phase]} */ ([c.kind + c.id, c.newPhase]))); starts.push(/** @type {Phase[]} */ (items.map(it => byId.get(it.kind + it.id) || it.phase))); }
    levels.filter(l => l.k > 0 && l.best).forEach(l => starts.push(/** @type {Cand} */ (l.best).arr));
    /** A random arrangement within the budget: up to maxMoves random moves from today. */
    const randomStart = () => {
      let arr = orig.slice();
      const m = 1 + randInt(rand, Math.max(1, maxMoves));
      for (let t = 0; t < 4 * m && movesOf(normalise(arr)) < m; t++) {
        const nb = arr.slice(), i = randInt(rand, n); nb[i] = PHASES.filter(p => p !== arr[i])[randInt(rand, 2)];
        if (movesOf(normalise(nb)) <= maxMoves) arr = nb;
      }
      return normalise(arr);
    };
    /** @type {Cand[]} */
    const restartBest = [];
    for (let r = 0; r < restarts; r++) {
      const startArr = r < starts.length ? starts[r] : randomStart();
      let cur = evaluate(startArr), best = cur;
      /** @type {Map<number, number>} tabu connection index → the step its tenure ends */
      const tabu = new Map();
      // Start temperature: ~80 % acceptance of the average worsening neighbour.
      const worse = [];
      for (let s = 0; s < 12; s++) { const nb = neighbour(cur.arr); if (!nb) continue; const c = evaluate(nb); if (c.scalar > cur.scalar) worse.push(c.scalar - cur.scalar); }
      let T = worse.length ? (worse.reduce((s, x) => s + x, 0) / worse.length) / -Math.log(0.8) : 1;
      const cool = Math.pow(1e-3, 1 / budget);
      const callsAtStart = calls;
      for (let step = 0; calls - callsAtStart < budget; step++) {
        if (step % 50 === 0) progress({ stage: `Annealing restart ${r + 1} of ${restarts}`, done: Math.min(budget, calls - callsAtStart), total: budget });
        const nb = neighbour(cur.arr);
        T *= cool;
        if (!nb) continue;
        const changed = nb.map((ph, i) => (ph !== cur.arr[i] ? i : -1)).filter(i => i >= 0);
        const c = evaluate(nb);
        const isTabu = changed.some(i => (tabu.get(i) ?? -1) > step);
        if (isTabu && !better(c, best)) continue;
        const delta = c.scalar - cur.scalar;
        if (delta <= 0 || rand() < Math.exp(-delta / Math.max(T, 1e-12))) {
          cur = c;
          changed.forEach(i => tabu.set(i, step + TABU_TENURE));
          if (better(c, best)) best = c;
        }
        if (step > 50 * budget) break; // every neighbour over budget or tabu — nothing left to try
      }
      restartBest.push(best);
    }
    const overall = restartBest.reduce((b, c) => (better(c, b) ? c : b));
    restartsFoundBest = { found: restartBest.filter(c => compareLex(c.tuple, overall.tuple) === 0).length, of: restarts };
    // Fill the levels the exact search didn't reach with the best found at each move count.
    for (let k = exactThrough + 1; k <= maxMoves; k++) {
      let best = null, distinct = 0, feasible = 0;
      cache.forEach(c => { if (c.moves === k) { distinct++; if (c.feasible) feasible++; if (better(c, best)) best = c; } });
      bestAt[k] = best;
      levels.push({ k, distinct, feasible, exact: false, best });
    }
  }

  /** A random neighbour within the budget: one connection to another phase, or a swap. @param {Phase[]} arr @returns {Phase[] | null} */
  function neighbour(arr) {
    const rand = neighbourRand;
    for (let attempt = 0; attempt < 20; attempt++) {
      const nb = arr.slice(), i = randInt(rand, n);
      if (rand() < 0.5) nb[i] = PHASES.filter(p => p !== arr[i])[randInt(rand, 2)];
      else {
        const j = randInt(rand, n);
        if (arr[j] === arr[i]) continue;
        nb[i] = arr[j]; nb[j] = arr[i];
      }
      const norm = normalise(nb);
      if (movesOf(norm) <= maxMoves && keyOf(norm) !== keyOf(arr)) return norm;
    }
    return null;
  }

  // Best within ≤ k moves, the recommendation and the nearby trade-offs.
  const describe = (/** @type {Cand} */ c) => ({
    moves: c.moves, objective: c.tuple, violations: c.ev.violations, totalViolations: c.ev.total, byYear: c.ev.byYear, lossKwh: c.ev.lossKwh,
    marginV: c.ev.marginV, feasible: c.feasible, converged: c.ev.converged,
    changed: changesOf(c.arr).map(ch => ({ kind: ch.kind, id: ch.id, pole: ch.pole, label: ch.label, kva: ch.kva, from: ch.phase, to: ch.newPhase }))
  });
  /** @type {Cand | null} */
  let running = null;
  const table = levels.sort((a, b) => a.k - b.k).map(l => {
    if (l.best && better(/** @type {Cand} */ (l.best), running)) running = /** @type {Cand} */ (l.best);
    return { k: l.k, distinct: l.distinct, feasible: l.feasible, exact: l.exact, bestAtK: l.best ? describe(/** @type {Cand} */ (l.best)) : null, bestWithin: running ? describe(running) : null };
  });
  const rec = archive.fewestFeasible(p => p.payload.feasible);
  const recommended = rec ? describe(rec.payload) : null;
  const alternatives = recommended ? [1, 2].map(extra => {
    /** @type {Cand | null} */
    let b = null;
    cache.forEach(c => { if (c.feasible && c.moves <= recommended.moves + extra && (!b || c.ev.lossKwh < b.ev.lossKwh - 1e-9)) b = c; });
    const found = /** @type {Cand | null} */ (b);
    return found && found.ev.lossKwh < recommended.lossKwh - 1e-9 ? { extraMoves: extra, ...describe(found) } : null;
  }).filter(Boolean) : [];
  const allExact = exactThrough >= maxMoves;
  const final = table[table.length - 1].bestWithin;
  return {
    txId, years, hours, solarMult, maxMoves, exactCap, seed, restarts: allExact ? 0 : restarts, budget,
    items, table, recommended, alternatives,
    today: describe(today),
    legacy: { moves: quick.changed.length, violations: legacyEv.violations, totalViolations: legacyEv.total, lossKwh: legacyEv.lossKwh, converged: legacyEv.converged },
    pareto: archive.points().map(p => ({ moves: p.criteria[0], violations: p.criteria[1], lossKwh: p.criteria[2] })),
    ...optResult({
      method: allExact ? 'Exhaustive by move count' : `Exhaustive to ${exactThrough} move${exactThrough === 1 ? '' : 's'}, then annealing + tabu`,
      certificate: allExact ? 'exact' : 'heuristic', objective: final ? final.objective : null,
      restartsFoundBest, evaluations: cache.size, ms: elapsedMs(t0), solution: recommended, verified: true,
      notes: [...notes, ...(allExact ? [`Every arrangement with up to ${maxMoves} moves was solved: the table is exact.`] : [])]
    })
  };
}
