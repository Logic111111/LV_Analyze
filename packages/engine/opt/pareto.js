// @ts-check
// Pareto archive (O1.5): keeps the solutions no other solution beats on every criterion at once —
// e.g. (moves, violations, kWh/day) for balancing, (capex, violations) for reconductoring. All
// criteria are minimised. A point is dropped when another is at least as good on every criterion
// and strictly better on one; an exact duplicate of a kept point is not added twice.

/** True if criteria `a` dominate `b` (all ≤, one <). @param {number[]} a @param {number[]} b @param {number} [tol] */
export function dominates(a, b, tol = 1e-9) {
  let strictly = false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] > b[i] + tol) return false;
    if (a[i] < b[i] - tol) strictly = true;
  }
  return strictly;
}

/**
 * @template P
 * @typedef {{ criteria: number[], payload: P }} ParetoPoint
 */
/**
 * @template P
 * @returns {{ insert: (criteria: number[], payload: P) => boolean, points: () => ParetoPoint<P>[], size: () => number,
 *   fewestFeasible: (feasible: (p: ParetoPoint<P>) => boolean) => ParetoPoint<P> | null }}
 */
export function createParetoArchive() {
  /** @type {ParetoPoint<P>[]} */
  let kept = [];
  const same = (/** @type {number[]} */ a, /** @type {number[]} */ b) => a.every((x, i) => Math.abs(x - b[i]) <= 1e-9);
  const sorted = () => kept.slice().sort((p, q) => { for (let i = 0; i < p.criteria.length; i++) if (p.criteria[i] !== q.criteria[i]) return p.criteria[i] - q.criteria[i]; return 0; });
  return {
    insert(criteria, payload) {
      if (kept.some(k => dominates(k.criteria, criteria) || same(k.criteria, criteria))) return false;
      kept = kept.filter(k => !dominates(criteria, k.criteria));
      kept.push({ criteria: criteria.slice(), payload });
      return true;
    },
    points: sorted,
    size() { return kept.length; },
    // The feasible point with the smallest first criterion (e.g. the fewest moves), ties broken by
    // the later criteria.
    fewestFeasible(feasible) { return sorted().find(feasible) || null; }
  };
}
