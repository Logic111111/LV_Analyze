// @ts-check
// The common result shape of every optimiser (O1.6), so the pages, the report and the badges read
// them the same way.
//   certificate 'exact'     — the search covered the whole space (or a proof did): no better
//                             answer exists under the stated objective and constraints.
//   certificate 'lp-bound'  — a verified answer plus an optimistic bound from a linear model;
//                             gapPct says how far the answer could be from the true optimum
//                             (as far as the linearisation is right).
//   certificate 'heuristic' — best found; restartsFoundBest says how many independent seeded
//                             restarts reached it (agreement is evidence, not proof).
// `verified: true` means the solution passed full load flows (converged) at every checked hour
// and year — no optimiser returns an unverified answer as feasible.

export const CERTIFICATES = /** @type {const} */ (['exact', 'lp-bound', 'heuristic']);

/**
 * @typedef {object} OptResult
 * @property {string} method
 * @property {'exact' | 'lp-bound' | 'heuristic'} certificate
 * @property {number | number[] | null} objective
 * @property {number} [bound]
 * @property {number} [gapPct]
 * @property {{ found: number, of: number }} [restartsFoundBest]
 * @property {number} evaluations
 * @property {number} ms
 * @property {any} solution
 * @property {boolean} verified
 * @property {string[]} notes
 */

/** @param {Partial<OptResult> & { method: string, certificate: OptResult['certificate'] }} r @returns {OptResult} */
export function optResult(r) {
  if (!CERTIFICATES.includes(r.certificate)) throw new Error(`Unknown certificate "${r.certificate}".`);
  return {
    method: r.method, certificate: r.certificate, objective: r.objective ?? null,
    ...(r.bound !== undefined ? { bound: r.bound } : {}),
    ...(r.gapPct !== undefined ? { gapPct: r.gapPct } : {}),
    ...(r.restartsFoundBest ? { restartsFoundBest: r.restartsFoundBest } : {}),
    evaluations: r.evaluations ?? 0, ms: r.ms ?? 0, solution: r.solution ?? null,
    verified: r.verified ?? true, notes: r.notes ?? []
  };
}

/** The badge text for a result: "Exact optimum", "Within x % of bound" or "Best found (x/N restarts agree)". @param {Pick<OptResult, 'certificate' | 'gapPct' | 'restartsFoundBest'>} r */
export function certificateLabel(r) {
  if (r.certificate === 'exact') return 'Exact optimum';
  if (r.certificate === 'lp-bound') return Number.isFinite(r.gapPct) ? `Within ${Number(r.gapPct).toFixed(1)} % of bound` : 'Bounded (gap unknown)';
  return r.restartsFoundBest ? `Best found (${r.restartsFoundBest.found}/${r.restartsFoundBest.of} restarts agree)` : 'Best found';
}

/** Milliseconds since `t0` (performance.now where available — browser, worker, Node). @param {number} t0 */
export function elapsedMs(t0) { return Math.round((nowMs() - t0) * 10) / 10; }
/** @returns {number} */
export function nowMs() { const p = /** @type {any} */ (globalThis).performance; return p && p.now ? p.now() : Date.now(); }
