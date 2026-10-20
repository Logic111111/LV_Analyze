// @ts-check
// Multi-hour scans: the 24-hour profile, loss accounting, and the scan summary every advisor
// scores candidates with.
import { PHASES } from './complex.js';
import { runSnapshot, warmStartFrom, topologyOf } from './solver.js';
import { connectionIndex } from './loads.js';
/** @import { Design, SnapshotResult, BessConnection } from './types.js' */

/* ============================================================
   24-HOUR PROFILE
============================================================ */
// Runs one snapshot per hour in `hours`, reusing the design's connection index and topology, and
// (unless warmStart is false) starting each hour from the previous hour's converged voltages. A
// warm start reaches the same fixed point within the solver's tolerance — measured at under
// 1e-3 V on every scan of the test fixtures, with identical violation counts — in fewer
// iterations. warmStart:false reproduces the cold-start values exactly (as a single runSnapshot
// gives), which is what the full-precision reference lock checks.
/**
 * @param {Design} design @param {number[]} hours
 * @param {import('./types.js').SnapshotOptions | Omit<import('./types.js').SnapshotOptions, 'hour'>} base Snapshot options other than `hour`.
 * @param {{ warmStart?: boolean }} [opts]
 * @returns {SnapshotResult[]}
 */
export function runHours(design, hours, base, opts = {}) {
  const warmStart = opts.warmStart !== false;
  const ctx = { index: connectionIndex(design), topo: topologyOf(design) };
  /** @type {SnapshotResult | null} */
  let prev = null;
  return hours.map(hour => {
    const res = runSnapshot(design, { ...base, hour }, { ...ctx, initialV: warmStart ? warmStartFrom(prev) : null });
    prev = res;
    return res;
  });
}

/**
 * @param {Design} design @param {number} year
 * @param {{ loadMult?: number, solarMult?: number, extraBess?: BessConnection[], warmStart?: boolean }} [opts]
 * @returns {SnapshotResult[]}
 */
export function runDailyScan(design, year, opts = {}) {
  const { loadMult = 1, solarMult = 1, extraBess = [], warmStart = true } = opts;
  return runHours(design, DAILY_HOURS, { year, loadMult, solarMult, extraBess }, { warmStart });
}

// Splits a runSnapshot result's losses into line vs. transformer (copper + no-load), and their
// sum — replaces the res.transformers.reduce(...) expression that used to be duplicated across
// report.js and ReportsPage.jsx.
/** @param {SnapshotResult} res @returns {{ lineLossW: number, txLossW: number, groundLossW: number, totalLossW: number }} */
export function systemLossW(res) {
  const txLossW = res.transformers.reduce((s, t) => s + t.txLossW + t.txNoLoadW, 0);
  const groundLossW = res.groundLossW || 0;
  return { lineLossW: res.totalLossW, txLossW, groundLossW, totalLossW: res.totalLossW + txLossW + groundLossW };
}

// Sums system loss (line + transformer) across a fresh 24-hour scan at year 0, nominal (1x)
// load/solar, with `extraBess` candidate BESS additions applied at every hour — used by the
// report's energy-loss section and to report the loss impact of a BESS hosting allocation.
/** @param {Design} design @param {BessConnection[]} [extraBess] @param {{ warmStart?: boolean }} [opts] @returns {{ lineKwh: number, txKwh: number, groundKwh: number, totalKwh: number }} */
export function dailyEnergyLossKwh(design, extraBess = [], opts = {}) {
  const daily = runDailyScan(design, 0, { loadMult: 1, solarMult: 1, extraBess, warmStart: opts.warmStart });
  let lineKwh = 0, txKwh = 0, groundKwh = 0;
  daily.forEach(res => {
    const { lineLossW, txLossW, groundLossW } = systemLossW(res);
    lineKwh += lineLossW / 1000; txKwh += txLossW / 1000; groundKwh += groundLossW / 1000;
  });
  return { lineKwh, txKwh, groundKwh, totalKwh: lineKwh + txKwh + groundKwh };
}

/* ============================================================
   SCAN SUMMARY (shared by every advisor)
============================================================ */
// Buckets an arbitrary set of snapshot results' violations by type and totals their loss — shared
// by the baseline (current design) and every candidate the split search evaluates, so both are
// scored on exactly the same basis. Not tied to a 24-hour scan specifically — `lossKwh` is really
// "loss over however many hours were scanned"; for a single-hour scan (solar/night peak-only
// testing — see DAILY_HOURS/scanAndSummarize below) that's numerically the same as the
// instantaneous kW figure, just labelled differently by the page.
//
// Also folds in a per-transformer breakdown (`transformers`) — worst-case loading and voltage
// band, plus total loss, for *every* transformer in the design over the same scanned hours — not
// used to rank candidates (voltage violations, then network loss, still decide that), but reported
// alongside so the whole network's picture (not just the new transformer, and not just whether a
// statutory line was crossed) is visible before choosing one. Computed in this same pass over
// `snapshots` rather than a second scan, since every figure it needs is already produced by
// runSnapshot regardless.
/** @param {SnapshotResult[]} snapshots */
export function summarizeScan(snapshots) {
  let voltageViolationCount = 0, thermalViolationCount = 0, txOverloadViolationCount = 0, lossKwh = 0;
  const txStats = {};
  snapshots.forEach(res => {
    res.violations.forEach(v => {
      if (v.type === 'undervoltage' || v.type === 'overvoltage') voltageViolationCount++;
      else if (v.type === 'thermal') thermalViolationCount++;
      else if (v.type === 'transformer overload') txOverloadViolationCount++;
    });
    lossKwh += systemLossW(res).totalLossW / 1000;
    res.transformers.forEach(t => {
      let s = txStats[t.id];
      if (!s) s = txStats[t.id] = { id: t.id, name: t.name, peakPct: 0, peakKva: 0, txMaxPhaseCurrentA: 0, minVPct: Infinity, maxVPct: -Infinity, lossKwh: 0 };
      if (t.txPct > s.peakPct) s.peakPct = t.txPct;
      if (t.txKVA > s.peakKva) s.peakKva = t.txKVA;
      PHASES.forEach(ph => { if (t.phaseCurrentA[ph] > s.txMaxPhaseCurrentA) s.txMaxPhaseCurrentA = t.phaseCurrentA[ph]; });
      PHASES.forEach(ph => { const v = t.busVoltPct[ph]; if (v < s.minVPct) s.minVPct = v; if (v > s.maxVPct) s.maxVPct = v; });
      s.lossKwh += (t.txLossW + t.txNoLoadW) / 1000;
    });
  });
  // Two transformer-current figures, reported side by side:
  //   - txMaxPhaseCurrentA: the solver's true worst phase current at the transformer over the
  //     scanned hours (max |I| over phases A/B/C and hours) — the primary figure, and the one to
  //     compare against the transformer's rated current or LV fuse;
  //   - peakCurrentA: the balanced-equivalent estimate from peak kVA, kVA·1000 / (√3·415 V) — kept
  //     because it's what a planner computes by hand. On an unbalanced transformer it can
  //     understate the worst phase by a factor of two or more, so it must never stand alone.
  const transformers = Object.values(txStats).map(s => ({ ...s, peakCurrentA: s.peakKva * 1000 / (Math.sqrt(3) * 415) }));
  const converged = snapshots.every(res => res.converged);
  return { voltageViolationCount, thermalViolationCount, txOverloadViolationCount, lossKwh, converged, transformers };
}

// The default "test conditions" for a split search — every hour of the day, nominal solar. The
// two alternatives (solar-peak-only, night-peak-only) reuse the exact same representative hours
// as DiagramPage's own "Quick snapshot" presets, for consistency across the app.
/** @type {number[]} */
export const DAILY_HOURS = [...Array(24).keys()];

// Runs one snapshot per hour in `hours` (year 0, nominal load, the given solar multiplier) and
// summarizes it — the one shared code path every split-search scorer below uses, so "test over
// the full day" vs "test at solar peak only" vs "test at night peak only" is just a different
// `hours`/`solarMult` pair, not different logic.
/** @param {Design} design @param {number[]} [hours] @param {number} [solarMult] @param {{ warmStart?: boolean }} [opts] */
export function scanAndSummarize(design, hours = DAILY_HOURS, solarMult = 1, opts = {}) {
  return summarizeScan(runHours(design, hours, { year: 0, loadMult: 1, solarMult }, opts));
}
