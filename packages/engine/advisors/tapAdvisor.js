// @ts-check
// Tap advisor: which off-load tap position suits a transformer best over the scanned hours and
// years. An off-load tap is ONE position for every hour of every day (changing it needs an
// outage), so a tap that fixes the evening undervoltage may cause midday overvoltage — every
// position is scanned over the full day for each checked year and compared on the same basis.
import { PHASES } from '../complex.js';
import { TAPS, transformerById, secondaryLNVoltage } from '../model.js';
import { runHours, systemLossW, DAILY_HOURS } from '../scan.js';
import { topologyOf } from '../solver.js';
/** @import { Design } from '../types.js' */

/**
 * @typedef {{ value: number, pole: string, phase: string, hour: number, year: number }} VoltageExtreme
 * @typedef {object} TapResult
 * @property {number} tap
 * @property {number} hvWindingV       HV winding voltage of this position, V.
 * @property {number} noLoadV          Open-circuit LV phase-neutral voltage at the design's HV supply, V.
 * @property {Record<number, number>} violationsByYear  Voltage violations (pole-phase-hours) per year.
 * @property {number} totalViolations
 * @property {Record<number, VoltageExtreme>} minVByYear
 * @property {Record<number, VoltageExtreme>} maxVByYear
 * @property {VoltageExtreme} minV
 * @property {VoltageExtreme} maxV
 * @property {number} marginV          Worst-case distance to the nearer limit over every pole, phase,
 *                                     hour and year, V (negative = outside the band).
 * @property {{ value: number, hour: number, year: number, pole: string } | null} worstHourSpread
 *   Largest gap between the highest and lowest phase voltage on this transformer within a single hour.
 * @property {number} kwhYear0          Whole-design daily energy loss in year 0, kWh.
 * @property {boolean} converged
 */

/**
 * @param {Design} design @param {string} txId
 * @param {{ horizon?: number, years?: number[], hours?: number[], solarMult?: number, onProgress?: (p: import('../types.js').Progress) => void }} [opts]
 */
export function tapAdvisor(design, txId, opts = {}) {
  const tx = transformerById(design, txId);
  if (!tx) throw new Error(`Transformer "${txId}" is not in the design.`);
  const horizon = opts.horizon ?? 5;
  const years = [...new Set(opts.years ?? [0, horizon])].sort((a, b) => a - b);
  const hours = opts.hours ?? DAILY_HOURS;
  const solarMult = opts.solarMult ?? 1;
  const vLow = design.vnom * (1 - design.vdev / 100), vHigh = design.vnom * (1 + design.vdev / 100);
  const bandWidthV = vHigh - vLow;

  // Only this transformer's poles are judged — another transformer's tap and voltages don't change.
  const { kidsMap } = topologyOf(design);
  const ownPoles = new Set();
  const stack = [...(kidsMap.get(txId) || [])];
  while (stack.length) { const id = stack.pop(); ownPoles.add(id); stack.push(...(kidsMap.get(id) || [])); }

  const taps = Object.keys(TAPS).map(Number).sort((a, b) => a - b);
  const totalSteps = taps.length * years.length * hours.length;
  let stepsDone = 0;

  /** @type {TapResult[]} */
  const byTap = taps.map(tap => {
    const d = { ...design, transformers: design.transformers.map(t => (t.id === txId ? { ...t, tap } : t)) };
    /** @type {Record<number, number>} */ const violationsByYear = {};
    /** @type {Record<number, VoltageExtreme>} */ const minVByYear = {};
    /** @type {Record<number, VoltageExtreme>} */ const maxVByYear = {};
    let marginV = Infinity, kwhYear0 = 0, converged = true;
    /** @type {TapResult['worstHourSpread']} */
    let worstHourSpread = null;
    years.forEach(year => {
      const snaps = runHours(d, hours, { year, loadMult: 1, solarMult }, {
        onProgress: opts.onProgress ? () => opts.onProgress({ stage: `Tap ${tap}, year ${year}`, done: ++stepsDone, total: totalSteps }) : undefined
      });
      let count = 0;
      /** @type {VoltageExtreme | null} */ let minV = null;
      /** @type {VoltageExtreme | null} */ let maxV = null;
      snaps.forEach(res => {
        if (!res.converged) converged = false;
        /** @type {VoltageExtreme | null} */ let hourMin = null;
        /** @type {VoltageExtreme | null} */ let hourMax = null;
        res.poleResults.forEach(pr => {
          if (!ownPoles.has(pr.id)) return;
          PHASES.forEach(ph => {
            const v = pr.volt[ph];
            const here = { value: v, pole: pr.id, phase: ph, hour: res.hour, year };
            if (v < vLow || v > vHigh) count++;
            if (!minV || v < minV.value) minV = here;
            if (!maxV || v > maxV.value) maxV = here;
            if (!hourMin || v < hourMin.value) hourMin = here;
            if (!hourMax || v > hourMax.value) hourMax = here;
            marginV = Math.min(marginV, v - vLow, vHigh - v);
          });
        });
        if (hourMin && hourMax) {
          const spread = hourMax.value - hourMin.value;
          if (!worstHourSpread || spread > worstHourSpread.value) worstHourSpread = { value: spread, hour: res.hour, year, pole: hourMin.pole };
        }
        if (year === years[0]) kwhYear0 += systemLossW(res).totalLossW / 1000;
      });
      violationsByYear[year] = count;
      minVByYear[year] = minV;
      maxVByYear[year] = maxV;
    });
    const all = years.map(y => minVByYear[y]).filter(Boolean);
    const allMax = years.map(y => maxVByYear[y]).filter(Boolean);
    return {
      tap, hvWindingV: TAPS[tap], noLoadV: secondaryLNVoltage({ ...tx, tap }),
      violationsByYear, totalViolations: years.reduce((s, y) => s + violationsByYear[y], 0),
      minVByYear, maxVByYear,
      minV: all.reduce((m, v) => (v.value < m.value ? v : m)), maxV: allMax.reduce((m, v) => (v.value > m.value ? v : m)),
      marginV: Number.isFinite(marginV) ? marginV : 0, worstHourSpread, kwhYear0, converged
    };
  });

  // Ranking: fewest violations over all checked years; then the widest worst-case margin to the
  // band; then the lowest year-0 energy loss.
  const ranked = [...byTap].sort((a, b) => a.totalViolations - b.totalViolations || b.marginV - a.marginV || a.kwhYear0 - b.kwhYear0);
  const best = ranked[0];

  /** @type {{ kind: 'unbalance' | 'swing' | 'step', message: string } | null} */
  let diagnosis = null;
  if (best.totalViolations > 0) {
    const spread = best.worstHourSpread;
    const range = best.maxV.value - best.minV.value;
    if (spread && spread.value > bandWidthV) {
      diagnosis = {
        kind: 'unbalance',
        message: `Unbalance limits the tap's benefit: at ${String(spread.hour).padStart(2, '0')}:00 in year ${spread.year} this transformer's highest and lowest phase voltages are ${spread.value.toFixed(1)} V apart — more than the whole ${bandWidthV.toFixed(1)} V statutory band. A tap moves every phase together, so no position can bring both ends inside the band. Balance the phases first (Load Balance), then re-run this advisor.`
      };
    } else if (range > bandWidthV) {
      diagnosis = {
        kind: 'swing',
        message: `Voltages on this transformer range from ${best.minV.value.toFixed(1)} V (${best.minV.pole} ${best.minV.phase}, ${String(best.minV.hour).padStart(2, '0')}:00, year ${best.minV.year}) to ${best.maxV.value.toFixed(1)} V (${best.maxV.pole} ${best.maxV.phase}, ${String(best.maxV.hour).padStart(2, '0')}:00, year ${best.maxV.year}) — ${range.toFixed(1)} V, wider than the ${bandWidthV.toFixed(1)} V band. A single off-load tap can't keep both ends in band; reduce the drop (reconductor, split the feeder) or the rise.`
      };
    } else {
      diagnosis = {
        kind: 'step',
        message: `The voltage range (${range.toFixed(1)} V) would fit inside the ${bandWidthV.toFixed(1)} V band, but none of the tap steps (2.5 %, about ${(design.vnom * 0.025).toFixed(1)} V) lands it there.`
      };
    }
  }

  return {
    txId, currentTap: tx.tap, years, hours: hours.length, vLow, vHigh, bandWidthV,
    byTap, ranked, recommendedTap: best.tap, diagnosis,
    note: 'Off-load tap changer: one position for every hour of every day, and changing it needs an outage.'
  };
}
