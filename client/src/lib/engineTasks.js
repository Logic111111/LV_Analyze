// The long-running engine work the UI hands to a Web Worker (P1.5), as named tasks, plus the tiny
// message protocol the worker speaks. Kept out of the worker file itself so it's plain, testable
// code: workers/engine.worker.js only wires `self` to handleEngineMessage.
//
// Each task is (args, hooks) => result. `args` and the result cross the worker boundary by
// structured clone, so they are plain data — no functions, and nothing big that the page doesn't
// need (e.g. a hosting baseline's warm-start phasors and connection index stay in the worker).
// Each task returns exactly what the page used to compute on the main thread, so moving work into
// the worker changes nothing the user sees except that the page stays responsive.
import {
  computeHostingCapacity, computeSystemHostingCapacity, pvHostingBaseline,
  computeBessHostingCapacity, computeSystemBessHostingCapacity, bessHostingBaseline,
  computeFeederSplitCandidates, searchDualFeederSplit, scoreDualFeederCandidate, makeTx, nextTransformerId,
  proposePhaseBalance, applyPhaseBalance, scanAndSummarize, runDailyScan, protectionCheck, tapAdvisor,
  reconductorAdvisor
} from './loadflow.js';
import { buildReportHtml } from './report.js';

const baselineSummary = (b) => ({ violations: b.violations, nonConvergedHours: b.nonConvergedHours });

export const ENGINE_TASKS = {
  hostingCapacity: ({ design }, hooks) => ({
    rows: computeHostingCapacity(design, undefined, hooks),
    baseline: baselineSummary(pvHostingBaseline(design))
  }),
  systemHostingCapacity: ({ design }, hooks) => computeSystemHostingCapacity(design, hooks),
  bessHostingCapacity: ({ design }, hooks) => ({
    rows: computeBessHostingCapacity(design, undefined, hooks),
    baseline: baselineSummary(bessHostingBaseline(design))
  }),
  systemBessHostingCapacity: ({ design }, hooks) => computeSystemBessHostingCapacity(design, hooks),

  feederSplitSingle: ({ design, rootPoleId, txSpec, siteSpec, hours, solarMult }, hooks) =>
    computeFeederSplitCandidates(design, rootPoleId, txSpec, siteSpec, hours, solarMult, hooks),
  feederSplitDual: ({ design, openPointId, txSpec, cond, hours, solarMult, shortlistK }, hooks) =>
    searchDualFeederSplit(design, openPointId, txSpec, cond, hours, solarMult, { shortlistK, onProgress: hooks.onProgress }),
  // No search: both cuts sit exactly at the open point's own poles (0 m connectors).
  feederSplitAtOpenPoint: ({ design, openPointId, txSpec, cond, hours, solarMult }) => {
    const op = design.openPoints.find(o => o.id === openPointId);
    const newTx = makeTx(nextTransformerId(design), txSpec);
    return { candidate: scoreDualFeederCandidate(design, op.poleA, op.poleB, openPointId, newTx, cond, hours, solarMult), newTx };
  },

  phaseBalance: ({ design, txId, hours, solarMult }, hooks) => {
    const p = proposePhaseBalance(design, txId);
    const beforeMetrics = scanAndSummarize(design, hours, solarMult, { onProgress: hooks.onProgress, stage: '1/2 Scanning the current design' });
    const balancedDesign = applyPhaseBalance(design, p.changed);
    const afterMetrics = scanAndSummarize(balancedDesign, hours, solarMult, { onProgress: hooks.onProgress, stage: '2/2 Scanning the rebalanced design' });
    return { ...p, beforeMetrics, afterMetrics, balancedDesign };
  },

  dailyScan: ({ design, year, loadMult, solarMult }, hooks) =>
    runDailyScan(design, year, { loadMult, solarMult, onProgress: hooks.onProgress, stage: 'Solving 24 hours' }),

  // Fault levels are instant; the load check needs the 24 h scan (year 0).
  protection: ({ design }, hooks) =>
    protectionCheck(design, runDailyScan(design, 0, { onProgress: hooks.onProgress, stage: 'Scanning 24 h for the load check' })),

  tapAdvisor: ({ design, txId, horizon }, hooks) => tapAdvisor(design, txId, { horizon, onProgress: hooks.onProgress }),
  reconductor: ({ design, years, maxCandidates }, hooks) => reconductorAdvisor(design, { years, maxCandidates, onProgress: hooks.onProgress }),

  report: ({ design, res, hosting, daily, bessHosting, extras }) => buildReportHtml(design, res, hosting, daily, bessHosting, extras)
};

// Progress messages are throttled: a hosting search can report thousands of steps, and each
// message costs a structured clone plus a React re-render on the page. The last step of a stage
// is always sent so the bar visibly completes.
const PROGRESS_INTERVAL_MS = 50;

/**
 * Handles one {id, task, args} request and posts back `progress` messages, then exactly one
 * `result` or `error`.
 * @param {{ id: number, task: string, args: any }} data
 * @param {(msg: any) => void} post
 * @param {() => number} [now]
 */
export function handleEngineMessage(data, post, now = Date.now) {
  const { id, task, args } = data || {};
  const fn = Object.prototype.hasOwnProperty.call(ENGINE_TASKS, task) ? ENGINE_TASKS[task] : null;
  if (!fn) { post({ id, type: 'error', error: `Unknown engine task "${task}".` }); return; }
  let last = -Infinity;
  const onProgress = (progress) => {
    const t = now();
    if (t - last >= PROGRESS_INTERVAL_MS || progress.done >= progress.total) {
      last = t;
      post({ id, type: 'progress', progress });
    }
  };
  try {
    post({ id, type: 'result', result: fn(args, { onProgress }) });
  } catch (err) {
    post({ id, type: 'error', error: err && err.message ? err.message : String(err), stack: err && err.stack });
  }
}
