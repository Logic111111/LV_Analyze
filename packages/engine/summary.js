// @ts-check
// Fleet-dashboard summary (P6.5): a compact record of a design's state, computed on save and
// stored beside it on the server, so a list of many designs can be sorted by how they're doing
// without loading or solving each one. From one 24 h scan at year 0 (nominal load and solar) and
// the protection check; the hosting total is included only when the caller has computed it.
import { runDailyScan, systemLossW } from './scan.js';
import { protectionCheck } from './faults.js';
import { PHASES } from './complex.js';
/** @import { Design } from './types.js' */

export const SUMMARY_VERSION = 1;

/** @param {Design} design @param {{ hostingTotalKva?: number | null }} [opts] */
export function designSummary(design, opts = {}) {
  const daily = runDailyScan(design, 0);
  const counts = { undervoltage: 0, overvoltage: 0, thermal: 0, transformer: 0, unbalance: 0 };
  /** @type {{ v: number, at: string }} */ let minV = { v: Infinity, at: '' };
  /** @type {{ v: number, at: string }} */ let maxV = { v: -Infinity, at: '' };
  let txPeak = 0, kwh = 0, converged = true;
  daily.forEach(r => {
    if (!r.converged) converged = false;
    r.violations.forEach(v => {
      if (v.type === 'undervoltage') counts.undervoltage++;
      else if (v.type === 'overvoltage') counts.overvoltage++;
      else if (v.type === 'thermal') counts.thermal++;
      else if (v.type === 'transformer overload') counts.transformer++;
      else if (v.type === 'unbalance') counts.unbalance++;
    });
    r.poleResults.forEach(p => PHASES.forEach(ph => {
      const at = `${p.id} ${ph} ${String(r.hour).padStart(2, '0')}:00`;
      if (p.volt[ph] < minV.v) minV = { v: p.volt[ph], at };
      if (p.volt[ph] > maxV.v) maxV = { v: p.volt[ph], at };
    }));
    r.transformers.forEach(t => { if (t.txPct > txPeak) txPeak = t.txPct; });
    kwh += systemLossW(r).totalLossW / 1000;
  });
  // The worst voltage is whichever extreme is furthest from nominal.
  const worst = Math.abs(minV.v - design.vnom) >= Math.abs(maxV.v - design.vnom) ? { ...minV, kind: 'low' } : { ...maxV, kind: 'high' };
  const prot = protectionCheck(design, daily);
  const pc = { pass: 0, fail: 0, missing: 0 };
  prot.devices.forEach(d => { pc[d.overall]++; });
  const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);
  return {
    v: SUMMARY_VERSION,
    poles: design.poles.length, connections: design.loads.length + design.pv.length + design.bess.length,
    transformers: design.transformers.length, ratingKva: design.transformers.reduce((s, t) => s + Number(t.txRating), 0),
    violations: { ...counts, total: counts.undervoltage + counts.overvoltage + counts.thermal + counts.transformer + counts.unbalance },
    minV: r1(minV.v), minAt: minV.at, maxV: r1(maxV.v), maxAt: maxV.at,
    worstV: r1(worst.v), worstAt: worst.at, worstDeviationPct: r1(Math.abs(worst.v - design.vnom) / design.vnom * 100),
    txPeakPct: r1(txPeak), lossKwhDay: Math.round(kwh * 100) / 100,
    hostingTotalKva: opts.hostingTotalKva != null && Number.isFinite(Number(opts.hostingTotalKva)) ? r1(Number(opts.hostingTotalKva)) : null,
    protection: prot.fuseLibraryEmpty ? 'no fuse data' : pc.fail ? 'fail' : pc.missing ? 'data missing' : 'pass',
    protectionCounts: pc, converged
  };
}
