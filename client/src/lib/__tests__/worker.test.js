import { describe, it, expect } from 'vitest';
import { ENGINE_TASKS, handleEngineMessage } from '../engineTasks.js';
import { runInWorker, isAbortError } from '../runInWorker.js';
import {
  computeHostingCapacity, pvHostingBaseline, dualFeederSetup, scoreFeederSplitCandidate,
  scoreDualFeederCandidate, scanAndSummarize, nextTransformerId, searchDualFeederSplit,
  proposePhaseBalance, applyPhaseBalance, runDailyScan, optimisePhaseBalance
} from '../loadflow.js';
import { walkthroughIsland } from './fixtures/walkthroughIsland.js';
import { syntheticFeeder } from './fixtures/syntheticFeeder.js';

// P1.5 — the worker task registry and protocol, and the promise client, tested in Node with a
// fake Worker that speaks the same protocol (structured clone simulated with JSON).

class FakeWorker {
  constructor() { this.terminated = false; this.onmessage = null; this.onerror = null; }
  postMessage(data) {
    const msgs = [];
    handleEngineMessage(JSON.parse(JSON.stringify(data)), m => msgs.push(JSON.parse(JSON.stringify(m))), () => msgs.length * 100);
    // Deliver each message in its own macrotask, like a real worker, so cancel can land mid-stream.
    msgs.forEach((m, i) => setTimeout(() => { if (!this.terminated && this.onmessage) this.onmessage({ data: m }); }, i));
  }
  terminate() { this.terminated = true; }
}

describe('handleEngineMessage (worker protocol)', () => {
  it('runs a task and posts exactly one result after its progress messages', () => {
    const d = walkthroughIsland();
    const msgs = [];
    handleEngineMessage({ id: 7, task: 'hostingCapacity', args: { design: d } }, m => msgs.push(m), () => 0);
    const result = msgs.filter(m => m.type === 'result');
    expect(result).toHaveLength(1);
    expect(msgs[msgs.length - 1].type).toBe('result');
    expect(msgs.every(m => m.id === 7)).toBe(true);
    expect(result[0].result.rows).toEqual(computeHostingCapacity(d));
    const b = pvHostingBaseline(d);
    expect(result[0].result.baseline).toEqual({ violations: b.violations, nonConvergedHours: b.nonConvergedHours });
  });

  it('throttles progress but always sends the last step', () => {
    const msgs = [];
    // A frozen clock: only "last step of a stage" messages may pass the 50 ms throttle.
    handleEngineMessage({ id: 1, task: 'hostingCapacity', args: { design: walkthroughIsland() } }, m => msgs.push(m), () => 0);
    const progress = msgs.filter(m => m.type === 'progress');
    expect(progress.length).toBe(2); // first step (throttle window opens) + final step
    expect(progress[progress.length - 1].progress).toMatchObject({ done: 9, total: 9 });
  });

  it('reports an unknown task and a throwing task as errors', () => {
    const msgs = [];
    handleEngineMessage({ id: 2, task: 'nope', args: {} }, m => msgs.push(m));
    handleEngineMessage({ id: 3, task: 'hostingCapacity', args: { design: null } }, m => msgs.push(m));
    expect(msgs[0]).toMatchObject({ id: 2, type: 'error' });
    expect(msgs[0].error).toMatch(/Unknown engine task "nope"/);
    expect(msgs[1]).toMatchObject({ id: 3, type: 'error' });
  });

  it('only runs registered tasks (no prototype lookups)', () => {
    const msgs = [];
    handleEngineMessage({ id: 4, task: 'toString', args: {} }, m => msgs.push(m));
    expect(msgs[0].type).toBe('error');
  });
});

describe('runInWorker', () => {
  const opts = (extra = {}) => ({ createWorker: () => new FakeWorker(), ...extra });

  it('resolves with the task result and reports progress', async () => {
    const seen = [];
    const d = walkthroughIsland();
    const r = await runInWorker('dailyScan', { design: d, year: 0, loadMult: 1, solarMult: 1 }, opts({ onProgress: p => seen.push(p) }));
    expect(r).toEqual(JSON.parse(JSON.stringify(runDailyScan(d, 0))));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1]).toMatchObject({ stage: 'Solving 24 hours', done: 24, total: 24 });
  });

  it('rejects with AbortError without starting a worker when already aborted', async () => {
    const ctrl = new AbortController(); ctrl.abort();
    let created = 0;
    await expect(runInWorker('dailyScan', {}, { signal: ctrl.signal, createWorker: () => { created++; return new FakeWorker(); } }))
      .rejects.toSatisfy(isAbortError);
    expect(created).toBe(0);
  });

  it('cancelling mid-run terminates the worker, rejects with AbortError and stops progress', async () => {
    const ctrl = new AbortController();
    let worker;
    let after = 0;
    const p = runInWorker('dailyScan', { design: syntheticFeeder(), year: 0, loadMult: 1, solarMult: 1 }, {
      signal: ctrl.signal,
      createWorker: () => (worker = new FakeWorker()),
      onProgress: () => { if (ctrl.signal.aborted) after++; else ctrl.abort(); }
    });
    await expect(p).rejects.toSatisfy(isAbortError);
    expect(worker.terminated).toBe(true);
    await new Promise(r => setTimeout(r, 50));
    expect(after).toBe(0);
  });

  it('rejects with the engine error message when the task throws', async () => {
    await expect(runInWorker('hostingCapacity', { design: null }, opts())).rejects.toMatchObject({ name: 'EngineError' });
  });

  it('rejects when the worker itself fails', async () => {
    const broken = { postMessage() { setTimeout(() => this.onerror({ message: 'boom', preventDefault() {} }), 0); }, terminate() {} };
    await expect(runInWorker('dailyScan', {}, { createWorker: () => broken })).rejects.toThrow('boom');
  });
});

describe('tasks reproduce what the pages computed on the main thread', () => {
  // A synthetic island with a common open point between feeders F1 and F2 (their 3rd poles).
  function openPointIsland() {
    const d = syntheticFeeder({ poles: 16, connections: 60 });
    d.openPoints = [{ id: 'OP1', poleA: 'P9', poleB: 'P10', spanM: 25, cond: '70ABC' }];
    return d;
  }
  const txSpec = { name: '', txRating: 250, tap: 2, hvActual: 11000, txXR: 3, txGroundOhms: 7.5 };

  it('searchDualFeederSplit equals the Feeder Split page\'s original staged loop', () => {
    const d = openPointIsland();
    const hours = [20], solarMult = 0, K = 3;
    // The page's runDual, verbatim apart from the setState/tick calls.
    const { feederA, feederB, poleIdsA, poleIdsB, shortlistTx, siteSpecA, siteSpecB } = dualFeederSetup(d, 'OP1', txSpec, '70ABC');
    const baseline = scanAndSummarize(d, hours, solarMult);
    const rank = (a, b) => a.voltageViolationCount - b.voltageViolationCount || a.lossKwh - b.lossKwh;
    const scoredA = poleIdsA.map(id => scoreFeederSplitCandidate(d, id, shortlistTx, siteSpecA, hours, solarMult)).sort(rank);
    const scoredB = poleIdsB.map(id => scoreFeederSplitCandidate(d, id, shortlistTx, siteSpecB, hours, solarMult)).sort(rank);
    const id = nextTransformerId(d);
    const newTx = { id, name: txSpec.name || id, txRating: txSpec.txRating, tap: txSpec.tap, hvActual: txSpec.hvActual, txXR: txSpec.txXR, txGroundOhms: txSpec.txGroundOhms };
    const candidates = [];
    for (const a of scoredA.slice(0, K).map(c => c.poleId)) for (const b of scoredB.slice(0, K).map(c => c.poleId)) {
      candidates.push(scoreDualFeederCandidate(d, a, b, 'OP1', newTx, '70ABC', hours, solarMult));
    }
    candidates.sort(rank);
    const expected = { feederA, feederB, newTx, baseline, candidates };

    expect(searchDualFeederSplit(d, 'OP1', txSpec, '70ABC', hours, solarMult, { shortlistK: K })).toEqual(expected);
    const viaTask = ENGINE_TASKS.feederSplitDual({ design: d, openPointId: 'OP1', txSpec, cond: '70ABC', hours, solarMult, shortlistK: K }, {});
    expect(viaTask).toEqual(expected);
  });

  it('phaseBalance equals the Load Balance page\'s original computation', () => {
    const d = walkthroughIsland();
    const p = proposePhaseBalance(d, 'TX');
    const balancedDesign = applyPhaseBalance(d, p.changed);
    const expected = { ...p, beforeMetrics: scanAndSummarize(d, [20], 0), afterMetrics: scanAndSummarize(balancedDesign, [20], 0), balancedDesign };
    expect(ENGINE_TASKS.phaseBalance({ design: d, txId: 'TX', hours: [20], solarMult: 0 }, {})).toEqual(expected);
  });

  it('phaseBalanceOptimised equals a direct optimisePhaseBalance call and clones cleanly', () => {
    const d = walkthroughIsland();
    const args = { objective: 'loadflow', kMax: 3, hours: [20], solarMult: 0, restarts: 1, iterations: 20, seed: 5 };
    const viaTask = ENGINE_TASKS.phaseBalanceOptimised({ design: d, txId: 'TX', ...args }, {});
    expect(viaTask).toEqual(optimisePhaseBalance(d, 'TX', args));
    expect(structuredClone(viaTask)).toEqual(viaTask);
  });

  it('every task result survives structured cloning (plain data only)', () => {
    const d = walkthroughIsland();
    const r = ENGINE_TASKS.feederSplitAtOpenPoint({ design: { ...openPointIsland() }, openPointId: 'OP1', txSpec, cond: '70ABC', hours: [20], solarMult: 0 }, {});
    expect(structuredClone(r)).toEqual(r);
    const h = ENGINE_TASKS.hostingCapacity({ design: d }, {});
    expect(structuredClone(h)).toEqual(h);
  });
});
