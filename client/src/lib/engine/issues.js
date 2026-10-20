// @ts-check
// Issues panel (P5.5): every current problem with the design in one list. Each issue has a
// severity, a location and a suggested fix that opens the relevant advisor pre-filtered. Built from
// one 24 h scan (year 0, nominal) plus the protection check and some plain data checks. Pure; the
// app runs it in the worker.
//
// Severity: 'error' = a statutory or rating limit is broken (or the load flow can't be trusted);
// 'warning' = something to look at (VUF above the limit while not counted as a violation,
// protection data missing, unusual input); 'info' = an assumption in force (e.g. HV fault level
// not set, so an infinite bus is used).
import { getConductor, transformerOfPole, isTransformerId, poleById } from './model.js';
import { conductorIssues } from './advisors/reconductor.js';
import { faultSettings } from './faults.js';
import { standardsOf } from './standards.js';
/** @import { Design, SnapshotResult } from './types.js' */
/**
 * @typedef {object} Issue
 * @property {string} id
 * @property {'error' | 'warning' | 'info'} severity
 * @property {string} category
 * @property {string} title
 * @property {string} detail
 * @property {{ pole?: string, phase?: string, txId?: string, hours?: number[] }} location
 * @property {{ label: string, route: string, params?: Record<string, string> } | null} fix
 */

export const LONG_SPAN_M = 60; // spans longer than this are flagged for checking (P5.8 validation)
const hh = (h) => String(h).padStart(2, '0') + ':00';
const hoursText = (hours) => (hours.length > 6 ? `${hours.length} hours (${hh(hours[0])}–${hh(hours[hours.length - 1])})` : hours.map(hh).join(', '));
const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 };

/**
 * @param {Design} design
 * @param {SnapshotResult[]} daily  runDailyScan(design, 0)
 * @param {any} [protection]        protectionCheck(design, daily)
 * @returns {Issue[]}
 */
export function collectIssues(design, daily, protection = null) {
  /** @type {Issue[]} */
  const out = [];
  const add = (/** @type {Issue} */ i) => out.push(i);
  const txOf = (pole) => transformerOfPole(design, pole) || '';

  // ---- load-flow violations, grouped per location ----
  /** @type {Map<string, { type: string, pole: string, phase: string, hours: number[], worst: number }>} */
  const groups = new Map();
  daily.forEach(r => r.violations.forEach(v => {
    const key = `${v.type}|${v.pole}|${v.phase}`;
    let g = groups.get(key);
    if (!g) groups.set(key, g = { type: v.type, pole: v.pole, phase: v.phase, hours: [], worst: v.value });
    g.hours.push(r.hour);
    if (v.type === 'undervoltage' ? v.value < g.worst : v.value > g.worst) g.worst = v.value;
  }));
  groups.forEach((g, key) => {
    if (g.type === 'undervoltage' || g.type === 'overvoltage') {
      const tx = txOf(g.pole);
      add({
        id: key, severity: 'error', category: 'voltage',
        title: `${g.type === 'undervoltage' ? 'Undervoltage' : 'Overvoltage'} at ${g.pole} phase ${g.phase}`,
        detail: `${g.worst.toFixed(1)} V at worst, ${hoursText(g.hours)}.`,
        location: { pole: g.pole, phase: g.phase, txId: tx, hours: g.hours },
        fix: { label: 'Open the fix-it ladder', route: 'fix-it', params: { tx } }
      });
    } else if (g.type === 'thermal') {
      add({
        id: key, severity: 'error', category: 'thermal', title: `Span into ${g.pole} overloaded (phase ${g.phase})`,
        detail: `${g.worst.toFixed(0)} % of rating at worst, ${hoursText(g.hours)}.`,
        location: { pole: g.pole, phase: g.phase, hours: g.hours },
        fix: { label: 'Find reconductoring options', route: 'reconductor', params: { pole: g.pole } }
      });
    } else if (g.type === 'transformer overload') {
      const root = design.poles.find(p => p.parent === g.pole);
      add({
        id: key, severity: 'error', category: 'transformer', title: `Transformer ${g.pole} overloaded`,
        detail: `${g.worst.toFixed(0)} % of rating at worst, ${hoursText(g.hours)}.`,
        location: { txId: g.pole, hours: g.hours },
        fix: { label: 'Look at a feeder split', route: 'feeder-split', params: root ? { root: root.id } : {} }
      });
    } else if (g.type === 'unbalance') {
      add({
        id: key, severity: 'error', category: 'unbalance', title: `Voltage unbalance at ${g.pole}`,
        detail: `VUF ${g.worst.toFixed(2)} % at worst, ${hoursText(g.hours)}.`,
        location: { pole: g.pole, txId: txOf(g.pole), hours: g.hours },
        fix: { label: 'Rebalance the phases', route: 'load-balance', params: { tx: txOf(g.pole) } }
      });
    }
  });

  // VUF above the limit while unbalance isn't counted as a violation: a warning per pole.
  const std = standardsOf(design);
  if (!std.vufAsViolation) {
    /** @type {Map<string, { worst: number, hours: number[] }>} */
    const vuf = new Map();
    daily.forEach(r => r.poleResults.forEach(p => {
      if (p.vufPct > r.vufLimitPct) {
        const g = vuf.get(p.id) || { worst: 0, hours: [] };
        g.worst = Math.max(g.worst, p.vufPct); g.hours.push(r.hour); vuf.set(p.id, g);
      }
    }));
    vuf.forEach((g, pole) => add({
      id: `vuf|${pole}`, severity: 'warning', category: 'unbalance', title: `VUF above ${std.vufLimitPct} % at ${pole}`,
      detail: `${g.worst.toFixed(2)} % at worst, ${hoursText(g.hours)}. (Not counted as a violation under the current standards profile.)`,
      location: { pole, txId: txOf(pole), hours: g.hours },
      fix: { label: 'Rebalance the phases', route: 'load-balance', params: { tx: txOf(pole) } }
    }));
  }

  // ---- solver trust ----
  const collapse = daily.filter(r => r.status === 'collapse').map(r => r.hour);
  if (collapse.length) add({
    id: 'collapse', severity: 'error', category: 'convergence', title: 'Voltage collapse',
    detail: `At ${hoursText(collapse)} the load is more than the network can deliver (a voltage below half of nominal). Those hours' figures are not a valid operating point.`,
    location: { hours: collapse }, fix: { label: 'Show it on the diagram', route: 'diagram', params: { hour: String(collapse[0]) } }
  });
  const nonConv = daily.filter(r => !r.converged && r.status !== 'collapse').map(r => r.hour);
  if (nonConv.length) add({
    id: 'nonconv', severity: 'error', category: 'convergence', title: 'Load flow did not converge',
    detail: `At ${hoursText(nonConv)}, even after the retry with gentler damping. Treat those hours' figures with caution.`,
    location: { hours: nonConv }, fix: { label: 'Show it on the diagram', route: 'diagram', params: { hour: String(nonConv[0]) } }
  });

  // ---- protection ----
  if (protection) {
    protection.devices.forEach(d => {
      if (d.overall === 'pass') return;
      const failing = Object.entries(d.checks).filter(([, c]) => c.status === d.overall).map(([k]) => k);
      add({
        id: `prot|${d.kind}|${d.key}`, severity: d.overall === 'fail' ? 'error' : 'warning', category: 'protection',
        title: `${d.label}: ${d.overall === 'fail' ? 'protection check fails' : 'protection data missing'}`,
        detail: failing.length ? `Checks: ${failing.join(', ')}.` : '',
        location: { txId: d.kind === 'feeder' ? d.locationNode : undefined, pole: d.kind === 'pole' ? d.key : undefined },
        fix: { label: 'Open the protection check', route: 'protection', params: { device: d.key } }
      });
    });
  }

  // ---- data ----
  const usedConds = new Set(design.poles.map(p => p.cond));
  usedConds.forEach(code => {
    const missing = conductorIssues(getConductor(design, code));
    if (missing.length) add({
      id: `cond|${code}`, severity: 'error', category: 'data', title: `Conductor ${code}: data missing`,
      detail: `Missing ${missing.join(', ')}. Spans of this conductor can't be solved reliably.`,
      location: {}, fix: { label: 'Edit the conductor library', route: 'setup', params: { section: 'conductors' } }
    });
  });
  design.poles.forEach(p => {
    if (!isTransformerId(design, p.parent) && !poleById(design, p.parent)) add({
      id: `orphan|${p.id}`, severity: 'error', category: 'data', title: `Pole ${p.id} has no valid parent`,
      detail: `Its parent "${p.parent}" is neither a pole nor a transformer.`, location: { pole: p.id },
      fix: { label: 'Fix it on the Network page', route: 'network', params: { pole: p.id } }
    });
    if (Number(p.spanM) > LONG_SPAN_M) add({
      id: `long|${p.id}`, severity: 'warning', category: 'data', title: `Long span into ${p.id} (${p.spanM} m)`,
      detail: `Longer than ${LONG_SPAN_M} m — check the entered length (typical LV pole spans are shorter).`, location: { pole: p.id },
      fix: { label: 'Check it on the Network page', route: 'network', params: { pole: p.id } }
    });
  });
  if (faultSettings(design).hvFaultMVA == null) add({
    id: 'hvfault', severity: 'info', category: 'data', title: 'HV fault level not set',
    detail: 'Fault currents assume an infinite HV bus (the largest Ik3max, a slightly optimistic Ik1min). Enter the utility\'s fault level for exact figures.',
    location: {}, fix: { label: 'Enter it in Setup', route: 'setup', params: { section: 'fault' } }
  });
  if (!((/** @type {any} */ (design).fuseLibrary) || []).length) add({
    id: 'fuselib', severity: 'warning', category: 'data', title: 'No fuse data',
    detail: 'The fuse library is empty, so no protection check can pass. Enter the fuses used (from the manufacturer\'s time-current curves).',
    location: {}, fix: { label: 'Open the protection check', route: 'protection' }
  });

  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.title.localeCompare(b.title));
}

/** Counts by severity. @param {Issue[]} issues */
export function issueCounts(issues) {
  const c = { error: 0, warning: 0, info: 0 };
  issues.forEach(i => { c[i.severity]++; });
  return c;
}

/** The pole-phase-hours a set of voltage issues covers (for a quick total). @param {Issue[]} issues */
export function voltageIssueHours(issues) {
  return issues.filter(i => i.category === 'voltage').reduce((n, i) => n + (i.location.hours || []).length, 0);
}
