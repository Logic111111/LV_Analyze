// @ts-check
// Linear programming (O1.2), written here because the engine takes no dependencies.
//
//   maximise cᵀx   subject to   A x ≤ b,   l ≤ x ≤ u      (l finite; u may be Infinity)
//
// Method: a dense, bounded-variable primal simplex in tableau form, two-phase.
//   - Shift x = l + y so every variable runs over [0, U] with U = u − l, and add a slack per row:
//     A y + s = b − A l, s ≥ 0.
//   - Rows whose right-hand side is negative start with an artificial variable (column −e_i) in
//     the basis instead of their slack. Phase 1 maximises −Σ artificials. A phase-1 optimum below
//     zero means no point satisfies the rows: 'infeasible'. Otherwise the artificials are fixed
//     at 0 (their upper bound becomes 0, so any still basic leave at the first chance) and
//     phase 2 maximises cᵀx from that feasible basis.
//   - Bounded variables never become extra rows: a nonbasic variable sits at its lower or its
//     upper bound, and the ratio test includes the entering variable's own range (a "bound flip"
//     when that is the tightest limit). Dense rows stay as short as the problem.
//   - Entering variable: Dantzig's rule (largest reduced cost) for speed. After 50 degenerate
//     pivots in a row (no progress, the situation in which simplex can cycle) it switches for good
//     to Bland's rule — smallest index enters, smallest-index basic variable leaves on a tie —
//     which provably cannot cycle.
//   - Tolerances 1e-9. Statuses: optimal | infeasible | unbounded | iteration_limit.
//
// Duals: π_i = −(reduced cost of slack i) = (c_B B⁻¹)_i — the slack columns of the tableau are
// B⁻¹ itself. At an optimum π ≥ 0, and π_i is the gain in cᵀx per unit of extra b_i; lpKkt()
// checks the full optimality conditions and the tests use it.
//
// Row generation (solveLPRowGeneration): hosting LPs have thousands of rows (hours × pole-phases
// × 2 + spans × 3 + transformers), almost all slack at the optimum. Solving with the few most
// binding rows, adding the rows the answer violates and re-solving reaches the same optimum on a
// much smaller tableau: the final answer satisfies every row and is optimal for a relaxation of
// the full problem, so it is optimal for the full problem.

export const LP_TOL = 1e-9;
const DEGENERATE_LIMIT = 50;

/** @typedef {{ c: number[], A: number[][], b: number[], l?: number[], u?: number[] }} LinearProgram */
/**
 * @typedef {object} LPSolution
 * @property {'optimal' | 'infeasible' | 'unbounded' | 'iteration_limit'} status
 * @property {number[]} x
 * @property {number} objective
 * @property {number[]} duals         π per row (≥ 0 at an optimum).
 * @property {number[]} reducedCosts  c_j − πᵀA_j per variable.
 * @property {number} iterations
 * @property {boolean} bland          Whether Bland's rule had to take over.
 */

/**
 * @param {LinearProgram} problem
 * @param {{ maxIterations?: number }} [opts]
 * @returns {LPSolution}
 */
export function solveLP(problem, opts = {}) {
  const { c, A, b } = problem;
  const n = c.length, m = A.length;
  const l = problem.l || Array(n).fill(0);
  const u = problem.u || Array(n).fill(Infinity);
  for (let j = 0; j < n; j++) if (!Number.isFinite(l[j])) throw new Error(`solveLP: lower bound of x${j} must be finite.`);
  const fail = (status) => ({ status, x: l.slice(), objective: NaN, duals: Array(m).fill(0), reducedCosts: Array(n).fill(0), iterations: 0, bland: false });
  for (let j = 0; j < n; j++) if (u[j] < l[j] - LP_TOL) return /** @type {LPSolution} */ (fail('infeasible'));

  // Columns: n structural, m slacks, then one artificial per row with a negative right-hand side.
  const rhs = b.map((bi, i) => bi - A[i].reduce((s, a, j) => s + a * l[j], 0));
  const artRows = [];
  for (let i = 0; i < m; i++) if (rhs[i] < 0) artRows.push(i);
  const N = n + m + artRows.length;
  const U = new Float64Array(N);
  for (let j = 0; j < n; j++) U[j] = Math.max(0, u[j] - l[j]);
  for (let j = n; j < N; j++) U[j] = Infinity;
  /** @type {Float64Array[]} */
  const T = [];
  const basis = new Int32Array(m);
  const xB = new Float64Array(m);
  const artOfRow = new Map(artRows.map((i, k) => [i, n + m + k]));
  for (let i = 0; i < m; i++) {
    const row = new Float64Array(N);
    const sign = artOfRow.has(i) ? -1 : 1; // B⁻¹ is diag(sign) for the starting basis
    for (let j = 0; j < n; j++) row[j] = sign * A[i][j];
    row[n + i] = sign;
    if (artOfRow.has(i)) { row[/** @type {number} */ (artOfRow.get(i))] = 1; basis[i] = /** @type {number} */ (artOfRow.get(i)); }
    else basis[i] = n + i;
    xB[i] = sign * rhs[i];
    T.push(row);
  }
  const atUpper = new Uint8Array(N);
  const isBasic = new Uint8Array(N);
  for (let i = 0; i < m; i++) isBasic[basis[i]] = 1;
  const maxIterations = opts.maxIterations ?? 50 * (m + N) + 1000;
  let iterations = 0, bland = false, degenerateRun = 0;
  const d = new Float64Array(N);

  /** @param {Float64Array} cost */
  const priceOut = (cost) => {
    for (let j = 0; j < N; j++) {
      let s = cost[j];
      for (let i = 0; i < m; i++) s -= cost[basis[i]] * T[i][j];
      d[j] = s;
    }
  };
  /** @param {number} r @param {number} q */
  const pivot = (r, q) => {
    const pr = T[r], pv = pr[q];
    for (let j = 0; j < N; j++) pr[j] /= pv;
    for (let i = 0; i < m; i++) {
      if (i === r) continue;
      const f = T[i][q];
      if (f === 0) continue;
      const row = T[i];
      for (let j = 0; j < N; j++) row[j] -= f * pr[j];
    }
    const fd = d[q];
    if (fd !== 0) for (let j = 0; j < N; j++) d[j] -= fd * pr[j];
  };

  /** One simplex phase on the current basis with reduced costs `d`. @returns {'optimal' | 'unbounded' | 'iteration_limit'} */
  const run = () => {
    for (;;) {
      if (iterations >= maxIterations) return 'iteration_limit';
      // Entering variable.
      let q = -1, best = 0;
      for (let j = 0; j < N; j++) {
        if (isBasic[j] || U[j] <= 0) continue;
        const gain = atUpper[j] ? -d[j] : d[j];
        if (gain > LP_TOL) {
          if (bland) { q = j; break; }
          if (gain > best) { best = gain; q = j; }
        }
      }
      if (q < 0) return 'optimal';
      iterations++;
      const sigma = atUpper[q] ? -1 : 1;
      // Ratio test: the entering variable's own range, then every basic variable's bounds.
      let tMax = U[q], r = -1, rAlpha = 0;
      for (let i = 0; i < m; i++) {
        const alpha = sigma * T[i][q];
        let t;
        if (alpha > LP_TOL) t = xB[i] / alpha;
        else if (alpha < -LP_TOL && Number.isFinite(U[basis[i]])) t = (U[basis[i]] - xB[i]) / -alpha;
        else continue;
        if (t < 0) t = 0;
        const better = t < tMax - LP_TOL
          || (Math.abs(t - tMax) <= LP_TOL && r >= 0 && (bland ? basis[i] < basis[r] : Math.abs(alpha) > Math.abs(rAlpha)));
        if (better || (r < 0 && t <= tMax - LP_TOL)) { tMax = t; r = i; rAlpha = alpha; }
      }
      if (!Number.isFinite(tMax)) return 'unbounded';
      const t = tMax;
      degenerateRun = t <= LP_TOL ? degenerateRun + 1 : 0;
      if (degenerateRun > DEGENERATE_LIMIT) bland = true;
      for (let i = 0; i < m; i++) xB[i] -= sigma * t * T[i][q];
      if (r < 0) { atUpper[q] = atUpper[q] ? 0 : 1; continue; } // bound flip, no pivot
      const leaving = basis[r];
      atUpper[leaving] = rAlpha < 0 ? 1 : 0;
      isBasic[leaving] = 0;
      xB[r] = sigma > 0 ? t : U[q] - t;
      basis[r] = q; isBasic[q] = 1; atUpper[q] = 0;
      pivot(r, q);
    }
  };

  // Phase 1.
  if (artRows.length) {
    const cost1 = new Float64Array(N);
    for (let j = n + m; j < N; j++) cost1[j] = -1;
    priceOut(cost1);
    const s1 = run();
    if (s1 === 'iteration_limit') return /** @type {LPSolution} */ ({ ...fail('iteration_limit'), iterations, bland });
    let infeas = 0;
    for (let i = 0; i < m; i++) if (basis[i] >= n + m) infeas += xB[i];
    const scale = 1 + rhs.reduce((s, v) => Math.max(s, Math.abs(v)), 0);
    if (infeas > 1e-7 * scale) return /** @type {LPSolution} */ ({ ...fail('infeasible'), iterations, bland });
    for (let j = n + m; j < N; j++) U[j] = 0;
    for (let i = 0; i < m; i++) if (basis[i] >= n + m) xB[i] = 0;
  }
  // Phase 2.
  const cost2 = new Float64Array(N);
  for (let j = 0; j < n; j++) cost2[j] = c[j];
  priceOut(cost2);
  const s2 = run();
  const y = new Float64Array(N);
  for (let j = 0; j < N; j++) y[j] = atUpper[j] ? U[j] : 0;
  for (let i = 0; i < m; i++) y[basis[i]] = xB[i];
  const x = Array.from({ length: n }, (_, j) => l[j] + Math.min(Math.max(y[j], 0), U[j]));
  const duals = Array.from({ length: m }, (_, i) => -d[n + i]);
  const reducedCosts = Array.from({ length: n }, (_, j) => d[j]);
  return { status: s2, x, objective: x.reduce((s, v, j) => s + c[j] * v, 0), duals, reducedCosts, iterations, bland };
}

/**
 * Worst violations of the optimality (KKT) conditions at a solution — all ≈ 0 at an optimum:
 *   primal:  A x ≤ b,  l ≤ x ≤ u
 *   dual:    π ≥ 0;  reduced cost r_j = c_j − πᵀA_j is ≤ 0 at a lower bound, ≥ 0 at an upper
 *            bound and 0 strictly between
 *   complementary slackness:  π_i · (b_i − A_i x) = 0
 * @param {LinearProgram} problem @param {Pick<LPSolution, 'x' | 'duals'>} sol
 */
export function lpKkt(problem, sol) {
  const { c, A, b } = problem;
  const n = c.length;
  const l = problem.l || Array(n).fill(0), u = problem.u || Array(n).fill(Infinity);
  const { x, duals } = sol;
  let primal = 0, dual = 0, comp = 0;
  A.forEach((row, i) => {
    const ax = row.reduce((s, a, j) => s + a * x[j], 0);
    primal = Math.max(primal, ax - b[i]);
    dual = Math.max(dual, -duals[i]);
    comp = Math.max(comp, Math.abs(duals[i] * (b[i] - ax)));
  });
  for (let j = 0; j < n; j++) {
    primal = Math.max(primal, l[j] - x[j], x[j] - u[j]);
    const r = c[j] - A.reduce((s, row, i) => s + duals[i] * row[j], 0);
    const atL = Math.abs(x[j] - l[j]) <= 1e-7 * (1 + Math.abs(l[j]));
    const atU = Number.isFinite(u[j]) && Math.abs(x[j] - u[j]) <= 1e-7 * (1 + Math.abs(u[j]));
    if (atL && atU) continue;               // fixed variable: any reduced cost is fine
    if (atL) dual = Math.max(dual, r);      // must be ≤ 0
    else if (atU) dual = Math.max(dual, -r); // must be ≥ 0
    else dual = Math.max(dual, Math.abs(r));
  }
  return { primal: Math.max(0, primal), dual: Math.max(0, dual), complementarity: comp };
}

/**
 * solveLP by row generation (see the module comment): start with `initialRows` (default: the
 * rows most violated at the bounds-only optimum), add up to `batch` violated rows per round.
 * @param {LinearProgram} problem
 * @param {{ initialRows?: number[], batch?: number, maxRounds?: number, tol?: number, maxIterations?: number }} [opts]
 * @returns {LPSolution & { rounds: number, rowsUsed: number }}
 */
export function solveLPRowGeneration(problem, opts = {}) {
  const { c, A, b } = problem;
  const n = c.length, m = A.length;
  const l = problem.l || Array(n).fill(0), u = problem.u || Array(n).fill(Infinity);
  const batch = opts.batch ?? 50, maxRounds = opts.maxRounds ?? 100, tol = opts.tol ?? 1e-7;
  const violation = (/** @type {number[]} */ x, /** @type {number} */ i) => A[i].reduce((s, a, j) => s + a * x[j], 0) - b[i];
  const mostViolated = (/** @type {number[]} */ x, /** @type {Set<number>} */ have) => {
    const out = [];
    for (let i = 0; i < m; i++) if (!have.has(i)) { const v = violation(x, i); if (v > tol * (1 + Math.abs(b[i]))) out.push([i, v / (1 + Math.hypot(...A[i]))]); }
    return out.sort((p, q) => q[1] - p[1] || p[0] - q[0]).slice(0, batch).map(p => p[0]);
  };
  const active = new Set(opts.initialRows || mostViolated(c.map((cj, j) => (cj > 0 && Number.isFinite(u[j]) ? u[j] : l[j])), new Set()));
  let rounds = 0;
  for (;;) {
    rounds++;
    const rows = [...active].sort((p, q) => p - q);
    const sol = solveLP({ c, A: rows.map(i => A[i]), b: rows.map(i => b[i]), l, u }, { maxIterations: opts.maxIterations });
    const duals = Array(m).fill(0);
    rows.forEach((i, k) => { duals[i] = sol.duals[k]; });
    const out = { ...sol, duals, rounds, rowsUsed: rows.length };
    if (sol.status === 'infeasible' || sol.status === 'iteration_limit') return out;
    if (sol.status === 'unbounded') {
      if (active.size === m) return out;
      for (let i = 0; i < m; i++) active.add(i);
      continue;
    }
    const add = mostViolated(sol.x, active);
    if (!add.length || rounds >= maxRounds) return add.length ? { ...out, status: 'iteration_limit' } : out;
    add.forEach(i => active.add(i));
  }
}
