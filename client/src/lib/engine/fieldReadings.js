// @ts-check
// Measured vs simulated (P6.4). Field readings (pole, phase, hour, V, optionally the span current)
// are compared with the load flow at the same hours: error = measured − simulated, with the bias
// (mean error), MAE and RMSE over all readings. Readings off by more than FLAG_V are flagged.
//
// Phase-label check: a customer recorded on the wrong phase is a common data error. If a reading
// is flagged and another phase's simulated voltage at the same pole and hour explains it much
// better (its error at most a third of the recorded phase's, and at least 2 V smaller), the
// reading is marked "likely recorded on phase X". These thresholds are heuristics, stated in the
// UI, and only raise a question for a site check.
import { runHours } from './scan.js';
/** @import { Design, Phase } from './types.js' */

export const FLAG_V = 3;
const PHASES = /** @type {Phase[]} */ (['A', 'B', 'C']);

/** CSV "pole, phase, hour, V[, A]"; a header line is skipped; bad lines are reported. @param {string} text */
export function parseFieldCsv(text) {
  const readings = [], errors = [];
  String(text).split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    const c = t.split(/[,;\t]/).map(x => x.trim());
    const phase = (c[1] || '').toUpperCase(), hour = Number(c[2]), v = Number(c[3]);
    const amps = c[4] !== undefined && c[4] !== '' ? Number(c[4]) : null;
    if (!c[0] || !['A', 'B', 'C'].includes(phase) || !Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isFinite(v) || (amps !== null && !Number.isFinite(amps))) {
      if (i === 0) return;
      errors.push(`Line ${i + 1}: "${t.slice(0, 60)}" — expected pole, phase A/B/C, hour 0–23, volts[, amps]`);
      return;
    }
    readings.push({ pole: c[0], phase: /** @type {Phase} */ (phase), hour, v, amps });
  });
  return { readings, errors };
}

/**
 * @param {Design} design
 * @param {{ pole: string, phase: Phase, hour: number, v: number, amps?: number | null }[]} readings
 * @param {{ year?: number, loadMult?: number, solarMult?: number }} [opts]
 */
export function compareMeasured(design, readings, opts = {}) {
  const { year = 0, loadMult = 1, solarMult = 1 } = opts;
  const hours = [...new Set(readings.map(r => r.hour))].sort((a, b) => a - b);
  const snaps = new Map(runHours(design, hours, { year, loadMult, solarMult }).map((s, i) => [hours[i], s]));
  const rows = [], unknown = [];
  readings.forEach(r => {
    const s = /** @type {any} */ (snaps.get(r.hour));
    const pr = s && s.poleResults.find(p => p.id === r.pole);
    if (!pr) { unknown.push(r); return; }
    const sim = pr.volt[r.phase];
    const error = r.v - sim;
    const others = PHASES.filter(p => p !== r.phase).map(p => ({ phase: p, error: r.v - pr.volt[p] }));
    const bestOther = others.reduce((a, b) => (Math.abs(b.error) < Math.abs(a.error) ? b : a));
    const flagged = Math.abs(error) > FLAG_V;
    const likelyPhase = flagged && Math.abs(bestOther.error) <= Math.abs(error) / 3 && Math.abs(error) - Math.abs(bestOther.error) >= 2 ? bestOther.phase : null;
    rows.push({
      ...r, simulatedV: sim, error, flagged, likelyPhase, converged: s.converged,
      simulatedA: pr.cur[r.phase], currentError: r.amps != null ? r.amps - pr.cur[r.phase] : null
    });
  });
  const errs = rows.map(x => x.error);
  const n = errs.length;
  const stats = n ? {
    n, biasV: errs.reduce((a, b) => a + b, 0) / n,
    maeV: errs.reduce((a, b) => a + Math.abs(b), 0) / n,
    rmseV: Math.sqrt(errs.reduce((a, b) => a + b * b, 0) / n),
    flagged: rows.filter(x => x.flagged).length,
    likelyPhaseErrors: rows.filter(x => x.likelyPhase).length
  } : null;
  return { year, loadMult, solarMult, rows, unknown, stats };
}
