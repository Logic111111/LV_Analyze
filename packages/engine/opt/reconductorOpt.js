// @ts-check
// Reconductoring as an optimisation (O6): choose a conductor for every span — keep it, or upgrade
// to a library conductor with lower phase R — to minimise, lexicographically,
//   1. violation-hours over the chosen years (voltage, thermal, transformer, VUF if counted),
//   2. capex (Σ span length × cost per metre) when every candidate conductor has a cost entered,
//      otherwise daily loss (kWh) — never an invented price,
//   3. then the other of the two, then the number of spans changed.
// The legacy advisor tries single spans and trunks to violating poles; this searches the whole
// space of combinations:
//   - Exact enumeration when the number of combinations is ≤ exactCap (default 5 000) and fits the
//     evaluation budget: every combination is solved, certificate 'exact'.
//   - Otherwise branch-and-bound over spans from the transformer outward. At each partial
//     assignment the remaining spans are set to their lowest-R option and solved: no completion
//     can do better on violations or loss than that (a conductor with lower impedance and at least
//     the same rating lowers every voltage drop and rise and every I²R), and none can cost less
//     than what is already decided. A branch is pruned when even that bound can't beat the best
//     complete answer so far. Finished within the budget → 'exact'.
//   - If the budget runs out, simulated annealing (seeded; random single-span changes, Metropolis
//     acceptance on violations × 1000 + objective) continues from the best answer found:
//     'heuristic'.
// Candidates are upgrade-only and only conductors whose data is complete (usableConductorCodes).
// The bound needs the lowest-R option to also have the highest rating; options where that fails
// are noted, and the search then can't certify exactness by bounding (enumeration still can).
import { conductorParams, bfsOrder } from '../model.js';
import { DAILY_HOURS } from '../scan.js';
import { usableConductorCodes, conductorCostPerM, applyReconductor } from '../advisors/reconductor.js';
import { createEvaluator, compareLex } from './evaluate.js';
import { rngFor, randInt } from './prng.js';
import { optResult, nowMs, elapsedMs } from './result.js';
/** @import { Design, ProgressHooks } from '../types.js' */

/**
 * @param {Design} design
 * @param {{ years?: number[], hours?: number[], budgetEvaluations?: number, saEvaluations?: number, exactCap?: number, seed?: number } & ProgressHooks} [opts]
 */
export function reconductorOptimise(design, opts = {}) {
  const t0 = nowMs();
  const years = opts.years && opts.years.length ? opts.years : [0];
  const hours = opts.hours && opts.hours.length ? opts.hours : DAILY_HOURS;
  const budget = Math.max(1, Math.floor(opts.budgetEvaluations ?? 2000));
  const saBudget = Math.max(0, Math.floor(opts.saEvaluations ?? 400));
  const exactCap = opts.exactCap ?? 5000;
  const progress = opts.onProgress || (() => {});
  const notes = [];
  const codes = usableConductorCodes(design);
  const R = (/** @type {string} */ c) => conductorParams(design, c).R;
  const I = (/** @type {string} */ c) => conductorParams(design, c).I;
  const poleById = new Map(design.poles.map(p => [p.id, p]));
  const spans = bfsOrder(design).map(id => /** @type {any} */ (poleById.get(id)));
  // Options per span: keep first, then upgrades by falling R (the last is the lowest-R one).
  const options = spans.map(p => [p.cond, ...codes.filter(c => R(c) < R(p.cond)).sort((a, b) => R(b) - R(a))]);
  const upgradeCodes = new Set(options.flatMap(o => o.slice(1)));
  const useCapex = upgradeCodes.size > 0 && [...upgradeCodes].every(c => conductorCostPerM(design, c) !== null);
  if (!useCapex && upgradeCodes.size) notes.push(`No cost per metre for ${[...upgradeCodes].filter(c => conductorCostPerM(design, c) === null).join(', ')} — ranked by daily loss instead of capex.`);
  let boundValid = true;
  options.forEach(o => { const last = o[o.length - 1]; if (o.some(c => I(c) > I(last))) boundValid = false; });
  if (!boundValid) notes.push('Some lowest-R option has a lower rating than another option, so branch-and-bound can\'t certify exactness; enumeration or annealing is used.');

  const evaluator = createEvaluator({ capacity: 20000 });
  const evalCount = () => evaluator.stats().misses;
  /** @param {number[]} choice option index per span */
  const changesOf = (choice) => choice.map((k, i) => ({ pole: spans[i].id, from: spans[i].cond, to: options[i][k], spanM: Number(spans[i].spanM) || 0 })).filter(c => c.to !== c.from);
  const capexOf = (/** @type {{ to: string, spanM: number }[]} */ ch) => ch.reduce((s, c) => s + c.spanM * (conductorCostPerM(design, c.to) || 0), 0);
  /** @param {number[]} choice */
  const evaluate = (choice) => {
    const changes = changesOf(choice);
    const ev = evaluator.evaluate(applyReconductor(design, changes), { years, hours });
    const viol = ev.total + (ev.converged ? 0 : 1e6), capex = capexOf(changes);
    const tuple = useCapex ? [viol, capex, ev.lossKwh, changes.length] : [viol, ev.lossKwh, changes.length];
    return { choice: choice.slice(), changes, viol, capex, lossKwh: ev.lossKwh, converged: ev.converged, tuple, ev };
  };
  const combos = options.reduce((p, o) => p * o.length, 1);
  /** @type {ReturnType<typeof evaluate> | null} */
  let best = null;
  const consider = (/** @type {ReturnType<typeof evaluate>} */ c) => { if (!best || compareLex(c.tuple, best.tuple) < 0) best = c; };
  const base = evaluate(spans.map(() => 0));
  consider(base);
  let method = '', certificate = /** @type {'exact' | 'heuristic'} */ ('exact');

  if (combos <= exactCap && combos <= budget) {
    method = `Enumeration of all ${combos} combinations`;
    const choice = spans.map(() => 0);
    for (let n = 0; n < combos; n++) {
      let r = n;
      for (let i = spans.length - 1; i >= 0; i--) { choice[i] = r % options[i].length; r = Math.floor(r / options[i].length); }
      consider(evaluate(choice));
      if (n % 10 === 0) progress({ stage: 'Enumerating every combination', done: n + 1, total: combos });
    }
  } else {
    method = 'Branch-and-bound';
    let exhausted = false, nodes = 0, pruned = 0;
    const choice = spans.map(() => 0);
    const lowest = options.map(o => o.length - 1);
    // Children order: cheapest first when ranking by capex, best conductor first when by loss.
    const orderOf = (/** @type {number} */ i) => { const ks = options[i].map((_, k) => k); return useCapex ? ks : ks.reverse(); };
    const dfs = (/** @type {number} */ depth) => {
      if (exhausted) return;
      if (evalCount() >= budget) { exhausted = true; return; }
      if (depth === spans.length) { consider(evaluate(choice)); return; }
      nodes++;
      if (best && boundValid) {
        const boundChoice = choice.map((k, i) => (i < depth ? k : lowest[i]));
        const b = evaluate(boundChoice);
        consider(b);
        const capexDecided = capexOf(changesOf(choice.map((k, i) => (i < depth ? k : 0))));
        const cur = /** @type {ReturnType<typeof evaluate>} */ (best);
        // A lexicographic lower bound on every completion: no fewer violations or less loss than
        // the all-lowest-R completion, no less capex than what's decided. (Equal capex means the
        // rest are kept, and then the loss can't beat the bound's either.)
        const lb = useCapex ? [b.viol, capexDecided, b.lossKwh] : [b.viol, b.lossKwh];
        const inc = useCapex ? [cur.viol, cur.capex, cur.lossKwh] : [cur.viol, cur.lossKwh];
        if (compareLex(lb, inc) >= 0) { pruned++; return; }
      }
      progress({ stage: `Branch-and-bound (${nodes} nodes, ${pruned} pruned)`, done: Math.min(evalCount(), budget), total: budget });
      for (const k of orderOf(depth)) { choice[depth] = k; dfs(depth + 1); if (exhausted) return; }
      choice[depth] = 0;
    };
    dfs(0);
    if (!boundValid) exhausted = true;
    notes.push(`${nodes} branch nodes, ${pruned} pruned by the bound.`);
    if (exhausted) {
      certificate = 'heuristic';
      method += boundValid ? ' (budget reached) + simulated annealing' : ' + simulated annealing';
      // Annealing from the best found.
      const rand = rngFor(opts.seed ?? 1);
      const scal = (/** @type {ReturnType<typeof evaluate>} */ c) => c.viol * 1000 + (useCapex ? c.capex / 1000 : c.lossKwh);
      let cur = /** @type {ReturnType<typeof evaluate>} */ (best);
      let T = Math.max(1, Math.abs(scal(cur)) * 0.05);
      const stop = evalCount() + saBudget;
      const cool = Math.pow(1e-3, 1 / Math.max(1, saBudget));
      for (let step = 0; evalCount() < stop && step < 50 * Math.max(1, saBudget); step++) {
        const i = randInt(rand, spans.length);
        if (options[i].length < 2) continue;
        const next = cur.choice.slice();
        next[i] = (next[i] + 1 + randInt(rand, options[i].length - 1)) % options[i].length;
        const c = evaluate(next);
        consider(c);
        const d = scal(c) - scal(cur);
        if (d <= 0 || rand() < Math.exp(-d / T)) cur = c;
        T *= cool;
        if (step % 20 === 0) progress({ stage: 'Annealing', done: Math.min(evalCount(), stop), total: stop });
      }
    }
  }
  const b = /** @type {ReturnType<typeof evaluate>} */ (best);
  const describe = (/** @type {ReturnType<typeof evaluate>} */ c) => ({ changes: c.changes, violations: c.ev.violations, totalViolations: c.ev.total, capex: useCapex ? c.capex : null, lossKwh: c.lossKwh, converged: c.converged });
  return {
    years, hours, useCapex, combinations: combos, spans: spans.length,
    best: describe(b), baseline: describe(base),
    ...optResult({ method, certificate, objective: b.tuple, evaluations: evalCount(), ms: elapsedMs(t0), solution: describe(b), verified: true, notes })
  };
}
