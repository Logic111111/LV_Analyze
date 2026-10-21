// @ts-check
// Dual-feeder split without missing the best pair (O5). Two feeders that meet at a normally-open
// point are both cut, and the two tails are fed from one new transformer near the open point;
// a candidate is a pair (cut on feeder A, cut on feeder B), scored jointly by a full 24 h scan
// (fewest voltage violations, then least loss — the legacy ranking).
//
// The legacy search shortlists the best k cuts on each side *separately*, then scores the k²
// pairs. A cut that is mediocre alone can be the best partner for the other side's cut, so the
// best pair can be missed. Here:
//   - If |A|·|B| ≤ pairCap, every pair is scored: certificate 'exact'.
//   - Otherwise: the legacy shortlist pairs, then local improvement around the best 3 pairs —
//     move either cut one pole upstream or downstream along its feeder, keep any better pair, and
//     repeat until nothing improves — plus 20 seeded random pairs as a sanity sample (if one of
//     them beats everything, it seeds another round of local improvement). The share of all pairs
//     actually scored is reported as coverage; certificate 'heuristic'.
import { poleById } from '../model.js';
import { DAILY_HOURS, scanAndSummarize } from '../scan.js';
import { nextTransformerId } from '../model.js';
import { dualFeederSetup, scoreDualFeederCandidate, scoreFeederSplitCandidate, makeTx } from '../advisors/feederSplit.js';
import { rngFor, randInt } from './prng.js';
import { optResult, nowMs, elapsedMs } from './result.js';
/** @import { Design, ProgressHooks } from '../types.js' */

/**
 * @param {Design} design @param {string} openPointId @param {any} txSpec @param {string} cond
 * @param {{ pairCap?: number, k?: number, seed?: number, hours?: number[], solarMult?: number, randomPairs?: number } & ProgressHooks} [opts]
 */
export function dualFeederOptimise(design, openPointId, txSpec, cond, opts = {}) {
  const t0 = nowMs();
  const pairCap = opts.pairCap ?? 400, k = opts.k ?? 5, seed = opts.seed ?? 1, randomPairs = opts.randomPairs ?? 20;
  const hours = opts.hours && opts.hours.length ? opts.hours : DAILY_HOURS;
  const solarMult = opts.solarMult ?? 1;
  const progress = opts.onProgress || (() => {});
  const { feederA, feederB, poleIdsA, poleIdsB, shortlistTx, siteSpecA, siteSpecB } = dualFeederSetup(design, openPointId, txSpec, cond);
  const newTx = makeTx(nextTransformerId(design), txSpec);
  const totalPairs = poleIdsA.length * poleIdsB.length;
  const baseline = scanAndSummarize(design, hours, solarMult);
  /** @param {any} a @param {any} b */
  const rank = (a, b) => a.voltageViolationCount - b.voltageViolationCount || a.lossKwh - b.lossKwh;

  /** @type {Map<string, any>} */
  const scored = new Map();
  /** @param {string} a @param {string} b */
  const score = (a, b) => {
    const key = a + '|' + b;
    let c = scored.get(key);
    if (!c) {
      c = scoreDualFeederCandidate(design, a, b, openPointId, newTx, cond, hours, solarMult);
      scored.set(key, c);
      progress({ stage: exact ? 'Scoring every pair' : 'Scoring pairs', done: scored.size, total: exact ? totalPairs : Math.min(totalPairs, pairCap) });
    }
    return c;
  };
  const exact = totalPairs <= pairCap;
  const notes = [];
  let localRounds = 0;
  if (exact) {
    poleIdsA.forEach(a => poleIdsB.forEach(b => score(a, b)));
  } else {
    // The legacy shortlist, k per side.
    const side = (/** @type {string[]} */ ids, /** @type {any} */ spec) => ids.map(id => scoreFeederSplitCandidate(design, id, shortlistTx, spec, hours, solarMult)).sort(rank).slice(0, k).map(c => c.poleId);
    const sa = side(poleIdsA, siteSpecA), sb = side(poleIdsB, siteSpecB);
    sa.forEach(a => sb.forEach(b => score(a, b)));
    // Neighbours along each feeder: the parent (upstream) and the children (downstream).
    const inA = new Set(poleIdsA), inB = new Set(poleIdsB);
    const near = (/** @type {string} */ id, /** @type {Set<string>} */ set) => {
      const p = poleById(design, id);
      return [p && set.has(p.parent) ? p.parent : null, ...design.poles.filter(q => q.parent === id && set.has(q.id)).map(q => q.id)].filter(Boolean);
    };
    const improveFrom = (/** @type {any[]} */ seeds) => {
      seeds.forEach(s => {
        let cur = s;
        for (;;) {
          localRounds++;
          const nbs = [...near(cur.poleA, inA).map(a => [a, cur.poleB]), ...near(cur.poleB, inB).map(b => [cur.poleA, b])];
          const best = nbs.map(([a, b]) => score(/** @type {string} */ (a), /** @type {string} */ (b))).sort(rank)[0];
          if (best && rank(best, cur) < 0) cur = best; else break;
        }
      });
    };
    improveFrom([...scored.values()].sort(rank).slice(0, 3));
    const rand = rngFor(seed);
    const bestBefore = [...scored.values()].sort(rank)[0];
    for (let i = 0; i < randomPairs; i++) score(poleIdsA[randInt(rand, poleIdsA.length)], poleIdsB[randInt(rand, poleIdsB.length)]);
    const bestAfter = [...scored.values()].sort(rank)[0];
    if (rank(bestAfter, bestBefore) < 0) { notes.push('A random sample pair beat the local search; it seeded another round.'); improveFrom([bestAfter]); }
  }
  const candidates = [...scored.values()].sort(rank);
  const coveragePct = scored.size / totalPairs * 100;
  if (!exact) notes.push(`${scored.size} of ${totalPairs} pairs scored (${coveragePct.toFixed(1)} %): the legacy ${k}×${k} shortlist, local improvement around the best 3 pairs, and ${randomPairs} random pairs.`);
  return {
    feederA, feederB, newTx, baseline, candidates, totalPairs, coveragePct, localSteps: localRounds,
    ...optResult({
      method: exact ? `Every pair (${totalPairs})` : 'Shortlist + local improvement + random sample',
      certificate: exact ? 'exact' : 'heuristic', objective: candidates[0] ? [candidates[0].voltageViolationCount, candidates[0].lossKwh] : null,
      evaluations: scored.size, ms: elapsedMs(t0), solution: candidates[0] || null, verified: true,
      notes: exact ? [`All ${totalPairs} pairs were scored with full 24 h load flows.`, ...notes] : notes
    })
  };
}
