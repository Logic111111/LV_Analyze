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
  reconductorAdvisor, fixItLadder, optimisePhaseBalance, voltageSensitivity, linearHostingEstimateKw, monteCarloStudy,
  runSnapshotAt, compareScenarios, collectIssues, traceHostingSearch, explainHosting, compareMeasured, designSummary,
  balanceExactDP, balanceOptimise, hostingMaxTotalSLP, hostingFairShare, evaluateDesign, withTxLimitRule, HOSTING_TEST_HOURS, bessLossOptimal, dualFeederOptimise
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
  // O5: every pair within the cap (exact), else shortlist + local improvement + random sample.
  feederSplitDualOptimised: ({ design, openPointId, txSpec, cond, hours, solarMult }, hooks) => {
    const { solution: _s, ...out } = dualFeederOptimise(design, openPointId, txSpec, cond, { hours, solarMult, onProgress: hooks.onProgress });
    return out;
  },
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

  // Phase balancing v2 (P4.1): the Pareto table, with each row's scan metrics.
  phaseBalanceOptimised: ({ design, txId, objective, kMax, hours, solarMult, restarts, iterations, seed }, hooks) =>
    optimisePhaseBalance(design, txId, { objective, kMax, hours, solarMult, restarts, iterations, seed, onProgress: hooks.onProgress }),

  // Optimisation Upgrade O2: exact balancing (dynamic programming) and balancing on the load-flow
  // goal (exhaustive levels, then annealing + tabu).
  balanceExactDP: ({ design, txId, objective, maxMoves }) => balanceExactDP(design, txId, { objective, maxMoves }),
  balanceOptimise: ({ design, txId, years, hours, solarMult, maxMoves, exactCap, restarts, budget, seed }, hooks) =>
    balanceOptimise(design, txId, { years, hours, solarMult, maxMoves, exactCap, restarts, budget, seed, onProgress: hooks.onProgress }),

  // O3.4: the three PV hosting answers side by side — the legacy queue, the SLP maximum total and
  // the fair share — with each allocation's peak reverse-flow loading and a live example of why
  // capacities interact.
  hostingCompare: ({ design, txLimitBothDirections, capKva }, hooks) => {
    const step = (stage) => (p) => hooks.onProgress && hooks.onProgress({ ...p, stage: `${stage}: ${p.stage}` });
    const d = withTxLimitRule(design, txLimitBothDirections);
    const q = computeSystemHostingCapacity(d, { onProgress: step('1/3 Queue') });
    const queue = { totalKva: q.totalKva, allocation: q.results.filter(r => r.achievableKva > 0).map(r => ({ pole: r.pole, phase: r.phase, kva: r.achievableKva })) };
    const slp = hostingMaxTotalSLP(design, { txLimitBothDirections, caps: capKva ?? undefined, onProgress: step('2/3 Maximum total') });
    const fair = hostingFairShare(design, { txLimitBothDirections, cap: capKva ?? 100, onProgress: step('3/3 Fair share') });
    const fairAlloc = fair.locations.map(l => ({ ...l, kva: fair.sizeKva }));
    const rev = (alloc) => evaluateDesign(d, { hours: HOSTING_TEST_HOURS, extraPV: alloc }).reverseFlowMax;
    // The location the optimum loads most beyond what it could take alone.
    const alone = new Map(q.results.map(r => [r.pole + '|' + r.phase, r.independentKva]));
    const ex = slp.allocation.map(a => ({ ...a, aloneKva: alone.get(a.pole + '|' + a.phase) ?? 0 })).sort((a, b) => (b.kva - b.aloneKva) - (a.kva - a.aloneKva))[0];
    const example = ex && ex.kva > ex.aloneKva + 0.5 ? { ...ex, neighbours: slp.allocation.filter(a => a.pole === ex.pole && a.phase !== ex.phase) } : null;
    const { solution: _s, ...slpOut } = slp;
    return {
      txLimitBothDirections: !!txLimitBothDirections, queue, slp: slpOut, fair: { ...fair, allocation: fairAlloc }, example,
      reverse: { queue: rev(queue.allocation), slp: rev(slp.allocation), fair: rev(fairAlloc) }
    };
  },

  // O4: BESS sizes for minimum daily loss.
  bessLossOptimal: ({ design, restarts, budget, seed, caps }, hooks) => {
    const { solution: _s, ...out } = bessLossOptimal(design, { restarts, budget, seed, caps, onProgress: hooks.onProgress });
    return out;
  },

  // Voltage sensitivity matrix (P4.2) at one operating point.
  voltageSensitivity: ({ design, year, hour, loadMult, solarMult }, hooks) =>
    voltageSensitivity(design, { year, hour, loadMult, solarMult, onProgress: hooks.onProgress }),
  // A first, linear hosting estimate per pole-phase from the sensitivities at one hour (voltage
  // limits only). The Hosting page labels it as such; the full search is the confirmation.
  linearHostingEstimate: ({ design, hour = 12 }, hooks) => {
    const sens = voltageSensitivity(design, { year: 0, hour, solarMult: 1, onProgress: hooks.onProgress });
    const rows = sens.blocks.flatMap(b => b.nodes.map(n => ({ pole: n.pole, phase: n.phase, ...linearHostingEstimateKw(sens, n.pole, n.phase) })))
      .sort((a, b) => b.kw - a.kw);
    return { hour, rows, converged: sens.blocks.every(b => b.converged) };
  },

  // Probabilistic planning (P4.4).
  monteCarlo: ({ design, year, evPct, pvPct, evSizes, pvSizes, runs, seed, hours }, hooks) =>
    monteCarloStudy(design, { year, evPct, pvPct, evSizes, pvSizes, runs, seed, hours, onProgress: hooks.onProgress }),

  // One hour for the single-line diagram's live hour slider (P5.1). Usually milliseconds, but with
  // SOC-BESS it simulates the day up to that hour, and on a big design that's worth keeping off
  // the UI thread.
  snapshotAt: ({ design, year, hour, loadMult, solarMult }) => runSnapshotAt(design, { year, hour, loadMult, solarMult }),

  // Scenario comparison (P5.4): a 24 h scan and protection check per scenario.
  compareScenarios: ({ design, scenarios }, hooks) => compareScenarios(design, scenarios, hooks),

  // Issues panel (P5.5): one 24 h scan (year 0), the protection check, and the data checks.
  issues: ({ design }) => {
    const daily = runDailyScan(design, 0);
    return collectIssues(design, daily, protectionCheck(design, daily));
  },

  // "Explain" for one hosting row (P5.6): the same search with every size tried.
  explainHosting: ({ design, pole, phase }) => explainHosting(traceHostingSearch(design, pole, phase)),

  // Measured vs simulated (P6.4).
  compareMeasured: ({ design, readings, year }) => compareMeasured(design, readings, { year }),

  // Fleet-dashboard summary stored with each save (P6.5).
  designSummary: ({ design, hostingTotalKva }) => designSummary(design, { hostingTotalKva }),

  dailyScan: ({ design, year, loadMult, solarMult }, hooks) =>
    runDailyScan(design, year, { loadMult, solarMult, onProgress: hooks.onProgress, stage: 'Solving 24 hours' }),

  // Fault levels are instant; the load check needs the 24 h scan (year 0).
  protection: ({ design }, hooks) =>
    protectionCheck(design, runDailyScan(design, 0, { onProgress: hooks.onProgress, stage: 'Scanning 24 h for the load check' })),

  tapAdvisor: ({ design, txId, horizon }, hooks) => tapAdvisor(design, txId, { horizon, onProgress: hooks.onProgress }),
  reconductor: ({ design, years, maxCandidates }, hooks) => reconductorAdvisor(design, { years, maxCandidates, onProgress: hooks.onProgress }),
  fixItLadder: ({ design, years, order, stopAtFirst }, hooks) => fixItLadder(design, { years, order, stopAtFirst, onProgress: hooks.onProgress }),

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
