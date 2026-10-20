// @ts-check
// Fix-it ladder: tries the usual remedies for a non-compliant island in order of disruption (by
// default: rebalance phases, change the off-load tap, restring spans, split a feeder, then the two
// cheap combinations) and stops at the first one that leaves no voltage violation in any checked
// year. Each step reuses the corresponding advisor exactly, so the ladder can never disagree with
// the dedicated pages; it only adds the "which remedy is enough" view on top.
import { applyPhaseBalance, proposePhaseBalance } from './phaseBalance.js';
import { tapAdvisor } from './tapAdvisor.js';
import { reconductorAdvisor, applyReconductor, describeReconductor, usableConductorCodes } from './reconductor.js';
import { buildSplitCandidate, computeFeederSplitCandidates, feederTrees, makeTx } from './feederSplit.js';
import { conductorParams, nextTransformerId, transformerOfPole } from '../model.js';
import { runHours, systemLossW, DAILY_HOURS } from '../scan.js';
/** @import { Design } from '../types.js' */

export const LADDER_STEPS = ['balance', 'tap', 'reconductor', 'split', 'balance+tap', 'balance+reconductor'];
export const LADDER_STEP_LABELS = {
  balance: 'Rebalance phases',
  tap: 'Change the off-load tap',
  reconductor: 'Restring spans',
  split: 'Split a feeder (new transformer)',
  'balance+tap': 'Rebalance phases + change tap',
  'balance+reconductor': 'Rebalance phases + restring spans'
};

/**
 * Voltage violations (pole-phase-hours) per checked year over the full day, and year-0 loss.
 * @param {Design} design @param {number[]} years @param {number[]} hours
 */
export function ladderMetrics(design, years, hours) {
  /** @type {Record<number, number>} */ const violationsByYear = {};
  /** @type {Record<string, number>} */ const byPole = {};
  let kwhYear0 = 0, converged = true;
  years.forEach((year, i) => {
    let n = 0;
    runHours(design, hours, { year, loadMult: 1, solarMult: 1 }).forEach(res => {
      if (!res.converged) converged = false;
      res.violations.forEach(v => { if (v.type === 'undervoltage' || v.type === 'overvoltage') { n++; byPole[v.pole] = (byPole[v.pole] || 0) + 1; } });
      if (i === 0) kwhYear0 += systemLossW(res).totalLossW / 1000;
    });
    violationsByYear[year] = n;
  });
  return { violationsByYear, totalViolations: years.reduce((s, y) => s + violationsByYear[y], 0), kwhYear0, converged, byPole };
}

/**
 * One remedy, applied to `design`: the changed design plus what it took. `design: null` = the
 * step couldn't produce anything (e.g. no larger conductor in the library).
 * @param {Design} design @param {string} step @param {{ years: number[], hours: number[] }} ctx
 * @returns {{ design: Design | null, actions: string[], moves?: number, capex?: number | null, lengthM?: number, tapChanges?: number, newTransformers?: number, note?: string }}
 */
function applyStep(design, step, ctx) {
  if (step === 'balance') {
    let d = design, moves = 0;
    const actions = [];
    design.transformers.forEach(tx => {
      const p = proposePhaseBalance(d, tx.id);
      if (p.changed.length) {
        d = applyPhaseBalance(d, p.changed);
        moves += p.changed.length;
        actions.push(`${tx.id}: move ${p.changed.map(c => `${c.id} ${c.phase}→${c.newPhase}`).join(', ')}`);
      }
    });
    return moves ? { design: d, actions, moves } : { design: null, actions: [], moves: 0, note: 'Already as balanced as the greedy method gets — no moves proposed.' };
  }
  if (step === 'tap') {
    let d = design, tapChanges = 0;
    const actions = [];
    design.transformers.forEach(tx => {
      const r = tapAdvisor(d, tx.id, { years: ctx.years, hours: ctx.hours });
      if (r.recommendedTap !== tx.tap) {
        d = { ...d, transformers: d.transformers.map(t => (t.id === tx.id ? { ...t, tap: r.recommendedTap } : t)) };
        tapChanges++;
        actions.push(`${tx.id}: tap ${tx.tap} → ${r.recommendedTap} (off-load, needs an outage)`);
      }
    });
    return tapChanges ? { design: d, actions, tapChanges } : { design: null, actions: [], tapChanges: 0, note: 'The current tap is already the best position.' };
  }
  if (step === 'reconductor') {
    const r = reconductorAdvisor(design, { years: ctx.years, hours: ctx.hours });
    const best = r.candidates[0];
    if (!best) return { design: null, actions: [], note: 'No larger conductor in the library to restring with — add sizes on the Setup page.' };
    return { design: applyReconductor(design, best.changes), actions: [`Restring ${describeReconductor(best.changes)}`], capex: best.capex, lengthM: best.lengthM };
  }
  if (step === 'split') {
    // The feeder with the most violations (over the checked years), split with a transformer of
    // the same type as the one feeding it, sited at the cut, with the lowest-resistance conductor
    // in the library for any connector. The Feeder Split page offers every other choice.
    const m = ladderMetrics(design, ctx.years, ctx.hours);
    const trees = feederTrees(design);
    if (!trees.length) return { design: null, actions: [], note: 'The design has no feeders.' };
    const score = (t) => design.poles.filter(p => transformerOfPole(design, p.id) === t.txId && p.feeder === t.feederName).reduce((s, p) => s + (m.byPole[p.id] || 0), 0);
    const tree = [...trees].sort((a, b) => score(b) - score(a))[0];
    const tx = design.transformers.find(t => t.id === tree.txId);
    const cond = [...usableConductorCodes(design)].sort((a, b) => conductorParams(design, a).R - conductorParams(design, b).R)[0];
    const txSpec = { txRating: tx.txRating, tap: tx.tap, hvActual: tx.hvActual, txXR: tx.txXR, txGroundOhms: tx.txGroundOhms };
    const r = computeFeederSplitCandidates(design, tree.rootPoleId, txSpec, { mode: 'atSplit', cond });
    const best = r.candidates[0];
    if (!best) return { design: null, actions: [], note: 'No split candidate on that feeder.' };
    const newTx = makeTx(nextTransformerId(design), txSpec);
    return { design: buildSplitCandidate(design, newTx, best.reparentPlan), actions: [`New ${tx.txRating} kVA transformer ${newTx.id} at ${best.poleId}, taking over ${best.movedPoleCount} pole(s) of ${tree.feederName}`], newTransformers: 1 };
  }
  if (step.includes('+')) {
    const [first, second] = step.split('+');
    const a = applyStep(design, first, ctx);
    const base = a.design || design;
    const b = applyStep(base, second, ctx);
    if (!a.design && !b.design) return { design: null, actions: [], note: [a.note, b.note].filter(Boolean).join(' ') };
    return {
      design: b.design || base,
      actions: [...a.actions, ...b.actions],
      moves: a.moves, tapChanges: b.tapChanges, capex: b.capex, lengthM: b.lengthM,
      note: [!a.design && a.note, !b.design && b.note].filter(Boolean).join(' ') || undefined
    };
  }
  throw new Error(`Unknown ladder step "${step}".`);
}

/**
 * @param {Design} design
 * @param {{ years?: number[], hours?: number[], order?: string[], stopAtFirst?: boolean, onProgress?: (p: import('../types.js').Progress) => void }} [opts]
 */
export function fixItLadder(design, opts = {}) {
  const years = [...new Set(opts.years ?? [0, 5])].sort((a, b) => a - b);
  const hours = opts.hours ?? DAILY_HOURS;
  const order = (opts.order ?? LADDER_STEPS).filter(s => LADDER_STEPS.includes(s));
  const stopAtFirst = opts.stopAtFirst !== false;
  const progress = opts.onProgress || (() => {});
  const total = order.length + 1;

  progress({ stage: 'Scanning the current design', done: 0, total });
  const baseline = ladderMetrics(design, years, hours);
  progress({ stage: 'Scanning the current design', done: 1, total });
  const steps = [];
  let solvedBy = null;
  if (baseline.totalViolations > 0) {
    for (let i = 0; i < order.length; i++) {
      const step = order[i];
      progress({ stage: `Trying: ${LADDER_STEP_LABELS[step]}`, done: i + 1, total });
      const applied = applyStep(design, step, { years, hours });
      const metrics = applied.design ? ladderMetrics(applied.design, years, hours) : null;
      const solves = !!metrics && metrics.totalViolations === 0;
      steps.push({ step, label: LADDER_STEP_LABELS[step], ...applied, metrics, solves });
      progress({ stage: `Trying: ${LADDER_STEP_LABELS[step]}`, done: i + 2, total });
      if (solves && !solvedBy) { solvedBy = step; if (stopAtFirst) break; }
    }
  }
  return { years, hours: hours.length, order, baseline, steps, solvedBy, alreadyCompliant: baseline.totalViolations === 0 };
}
