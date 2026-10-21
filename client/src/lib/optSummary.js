// O7: one optimiser run, summarised for the report's Optimisation section (see report.js).
/** @param {string} title @param {string} headline @param {any} r an optimiser result (common shape, engine opt/result.js) */
export function optSummary(title, headline, r) {
  return { title, headline, method: r.method, certificate: r.certificate, gapPct: r.gapPct, restartsFoundBest: r.restartsFoundBest, evaluations: r.evaluations, ms: r.ms, notes: r.notes || [] };
}
