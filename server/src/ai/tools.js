// The AI Insights tools (P7.7): each one runs the shared engine on the design the client sent and
// returns a compact, rounded summary for the model (results are capped in size: the model reads
// every byte, and an LV island can have hundreds of poles). Tools that find a change — phase
// balance, tap, reconductor — also return a *proposal*: a design patch the client can preview
// with its existing preview flow. Nothing here saves anything.
//
// This module is plain data + pure functions over an `engine` object (packages/engine), so the
// same code runs in the worker thread (toolWorker.js) and in tests.

const MAX_RESULT_CHARS = 12000;
const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : x);
const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : x);
const clampInt = (v, lo, hi, dflt) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : dflt; };
const clampNum = (v, lo, hi, dflt) => { const n = Number(v); return Number.isFinite(n) ? Math.min(Math.max(n, lo), hi) : dflt; };

/** Tool definitions in the Messages API's custom-tool shape. */
const TOOL_DEFS = [
  {
    name: 'run_snapshot',
    description: 'Solve the unbalanced 4-wire load flow for one hour. Returns status, voltage violations, the lowest and highest phase-neutral voltage per pole, transformer loading and flow direction, line losses and the worst voltage unbalance. Use it to check any hour (20:00 is the usual evening peak, 12:00 solar peak).',
    input_schema: {
      type: 'object',
      properties: {
        hour: { type: 'integer', minimum: 0, maximum: 23, description: 'Hour of day, 0-23.' },
        year: { type: 'integer', minimum: 0, maximum: 30, description: 'Years of load growth from today (0 = today).' },
        load_mult: { type: 'number', minimum: 0.1, maximum: 3, description: 'Multiplier on every load (default 1).' },
        solar_mult: { type: 'number', minimum: 0, maximum: 2, description: 'Multiplier on solar output (default 1; 0 = no sun).' }
      },
      required: ['hour']
    }
  },
  {
    name: 'run_daily_scan',
    description: 'Solve all 24 hours of a day. Returns per-hour lowest/highest voltage and violation counts, daily energy loss, peak transformer loading and the worst voltage unbalance.',
    input_schema: {
      type: 'object',
      properties: {
        year: { type: 'integer', minimum: 0, maximum: 30, description: 'Years of load growth (default 0).' },
        solar_mult: { type: 'number', minimum: 0, maximum: 2, description: 'Solar multiplier (default 1).' }
      }
    }
  },
  {
    name: 'propose_phase_balance',
    description: 'Propose moving single-phase connections between phases to balance one transformer (greedy, by nameplate kVA). Returns the moves, phase totals before/after, the 24 h violation count and energy loss before/after, and a proposal id the engineer can preview.',
    input_schema: {
      type: 'object',
      properties: { transformer_id: { type: 'string', description: 'Transformer id (default: the first transformer).' } }
    }
  },
  {
    name: 'tap_advisor',
    description: 'Evaluate every off-load tap position of one transformer over today and a future year: violations per year, voltage extremes and margin to the statutory band. Returns the best tap and, when it differs from the present one, a proposal id.',
    input_schema: {
      type: 'object',
      properties: {
        transformer_id: { type: 'string', description: 'Transformer id (default: the first transformer).' },
        horizon_years: { type: 'integer', minimum: 1, maximum: 20, description: 'Future year to check as well as today (default 5).' }
      }
    }
  },
  {
    name: 'reconductor_advisor',
    description: 'Rank conductor upgrades (single spans and trunks to violating poles) by violations removed, then capex (only when the design has conductor costs) or energy loss. Returns the top candidates and a proposal id for the best one.',
    input_schema: {
      type: 'object',
      properties: { max_candidates: { type: 'integer', minimum: 1, maximum: 80, description: 'How many candidate change sets to evaluate (default 40).' } }
    }
  },
  {
    name: 'fault_levels',
    description: 'Maximum three-phase and minimum phase-neutral prospective fault currents at each transformer\'s LV terminals and at every pole (IEC 60909-style method with the design\'s settings).',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'hosting_capacity',
    description: 'Rooftop PV hosting capacity: the largest single-phase PV each pole/phase can take on its own without a new or worsened violation (load flows at the test hours). Returns the most and least constrained locations and what limits them. Can take several seconds on large designs.',
    input_schema: { type: 'object', properties: {} }
  }
];
const TOOL_NAMES = new Set(TOOL_DEFS.map(t => t.name));

/** Caps a result's JSON size by trimming its longest arrays, and says so. */
function capResult(obj) {
  let out = obj;
  for (let guard = 0; guard < 12 && JSON.stringify(out).length > MAX_RESULT_CHARS; guard++) {
    let key = null, len = 0;
    Object.entries(out).forEach(([k, v]) => { if (Array.isArray(v) && v.length > len) { key = k; len = v.length; } });
    if (!key || len <= 3) break;
    out = { ...out, [key]: out[key].slice(0, Math.ceil(len / 2)), [`${key}Truncated`]: `showing ${Math.ceil(len / 2)} of ${obj[key].length}` };
  }
  return out;
}

function txIdOf(design, id) {
  if (id && design.transformers.some(t => t.id === id)) return id;
  if (id) throw new Error(`Transformer "${id}" is not in the design (ids: ${design.transformers.map(t => t.id).join(', ')}).`);
  return design.transformers[0].id;
}

function snapshotSummary(res) {
  const poles = res.poleResults.map(p => {
    const v = [p.volt.A, p.volt.B, p.volt.C];
    const lo = Math.min(...v), hi = Math.max(...v);
    return { pole: p.id, minV: r1(lo), minPhase: 'ABC'[v.indexOf(lo)], maxV: r1(hi), maxPhase: 'ABC'[v.indexOf(hi)], maxLoadingPct: r1(Math.max(p.condPct.A, p.condPct.B, p.condPct.C)), vufPct: r2(p.vufPct) };
  }).sort((a, b) => a.minV - b.minV);
  return {
    status: res.status, year: res.year, hour: res.hour, voltageBandV: [r1(res.vLimLow), r1(res.vLimHigh)],
    violationCount: res.violations.length,
    violations: res.violations.map(v => ({ pole: v.pole, phase: v.phase, type: v.type, value: r1(v.value) })),
    transformers: res.transformers.map(t => ({ id: t.id, loadingPct: r1(t.txPct), flowDirection: t.flowDirection, netKW: r1(t.netKW), busVoltPct: { A: r1(t.busVoltPct.A), B: r1(t.busVoltPct.B), C: r1(t.busVoltPct.C) } })),
    lineLossKW: r2(res.totalLossW / 1000),
    worstVuf: res.worstVuf ? { pole: res.worstVuf.pole, pct: r2(res.worstVuf.value) } : null,
    polesLowestFirst: poles
  };
}

function dayMetrics(engine, design, year = 0) {
  const snaps = engine.runDailyScan(design, year);
  const s = engine.summarizeScan(snaps);
  return { snaps, summary: s, violations: s.voltageViolationCount + s.thermalViolationCount + s.txOverloadViolationCount };
}

/**
 * Runs one tool. Returns { result } (JSON-able, size-capped) and, for a proposal, { proposal:
 * { tool, title, summary, patch } } — the server gives it an id.
 * @param {any} engine the shared engine module @param {any} design (already through withDefaults)
 * @param {string} name @param {any} input
 */
function runEngineTool(engine, design, name, input = {}) {
  if (!TOOL_NAMES.has(name)) throw new Error(`Unknown tool "${name}".`);
  const inp = input && typeof input === 'object' ? input : {};
  switch (name) {
    case 'run_snapshot': {
      const opts = { year: clampInt(inp.year, 0, 30, 0), hour: clampInt(inp.hour, 0, 23, 20), loadMult: clampNum(inp.load_mult, 0.1, 3, 1), solarMult: clampNum(inp.solar_mult, 0, 2, 1) };
      return { result: capResult(snapshotSummary(engine.runSnapshotAt(design, opts))) };
    }
    case 'run_daily_scan': {
      const year = clampInt(inp.year, 0, 30, 0), solarMult = clampNum(inp.solar_mult, 0, 2, 1);
      const snaps = engine.runDailyScan(design, year, { solarMult });
      const s = engine.summarizeScan(snaps);
      const hours = snaps.map(res => {
        let lo = Infinity, hi = -Infinity;
        res.poleResults.forEach(p => ['A', 'B', 'C'].forEach(ph => { lo = Math.min(lo, p.volt[ph]); hi = Math.max(hi, p.volt[ph]); }));
        return { hour: res.hour, status: res.status, minV: r1(lo), maxV: r1(hi), violations: res.violations.length, txLoadingPct: res.transformers.map(t => r1(t.txPct)) };
      });
      return { result: capResult({
        year, solarMult, converged: s.converged,
        voltageViolations: s.voltageViolationCount, thermalViolations: s.thermalViolationCount, transformerOverloads: s.txOverloadViolationCount,
        dailyLineLossKwh: r2(s.lossKwh), worstVuf: s.worstVuf ? { ...s.worstVuf, value: r2(s.worstVuf.value) } : null,
        transformers: s.transformers.map(t => ({ id: t.id, peakLoadingPct: r1(t.peakPct), maxPhaseCurrentA: r1(t.txMaxPhaseCurrentA), minBusVoltPct: r1(t.minVPct), maxBusVoltPct: r1(t.maxVPct) })),
        hours
      }) };
    }
    case 'propose_phase_balance': {
      const txId = txIdOf(design, inp.transformer_id);
      const p = engine.proposePhaseBalance(design, txId);
      if (!p.changed.length) return { result: { transformer: txId, moves: [], note: 'Already as balanced as the greedy method can make it — no moves proposed.', phaseKva: { A: r1(p.before.A), B: r1(p.before.B), C: r1(p.before.C) } } };
      const after = engine.applyPhaseBalance(design, p.changed);
      const b = dayMetrics(engine, design), a = dayMetrics(engine, after);
      const result = {
        transformer: txId,
        moves: p.changed.map(c => ({ id: c.id, kind: c.kind, pole: c.pole, from: c.phase, to: c.newPhase, kva: r2(c.kva) })),
        phaseKvaBefore: { A: r1(p.before.A), B: r1(p.before.B), C: r1(p.before.C) },
        phaseKvaAfter: { A: r1(p.after.A), B: r1(p.after.B), C: r1(p.after.C) },
        violations24h: { before: b.violations, after: a.violations },
        dailyLineLossKwh: { before: r2(b.summary.lossKwh), after: r2(a.summary.lossKwh) }
      };
      return { result: capResult(result), proposal: { tool: name, title: `Rebalance ${p.changed.length} connection${p.changed.length === 1 ? '' : 's'} on ${txId}`, summary: `24 h violations ${b.violations} → ${a.violations}; daily loss ${r2(b.summary.lossKwh)} → ${r2(a.summary.lossKwh)} kWh`, patch: engine.designPatch(design, after) } };
    }
    case 'tap_advisor': {
      const txId = txIdOf(design, inp.transformer_id);
      const horizon = clampInt(inp.horizon_years, 1, 20, 5);
      const t = engine.tapAdvisor(design, txId, { horizon });
      const current = t.currentTap;
      const rows = t.byTap.map(x => ({ tap: x.tap, violationsByYear: x.violationsByYear, minV: r1(x.minV.value), maxV: r1(x.maxV.value), marginV: r1(x.marginV), converged: x.converged }));
      const best = t.recommendedTap;
      const result = { transformer: txId, currentTap: current, years: t.years, recommendedTap: best, diagnosis: t.diagnosis ? t.diagnosis.message : null, note: t.note, byTap: rows };
      if (best == null || best === current) return { result: capResult(result) };
      const after = { ...design, transformers: design.transformers.map(x => (x.id === txId ? { ...x, tap: best } : x)) };
      return { result: capResult(result), proposal: { tool: name, title: `Tap ${current} → ${best} on ${txId}`, summary: `Recommended by the tap advisor over years ${t.years.join(' and ')}`, patch: engine.designPatch(design, after) } };
    }
    case 'reconductor_advisor': {
      const r = engine.reconductorAdvisor(design, { maxCandidates: clampInt(inp.max_candidates, 1, 80, 40) });
      const top = r.candidates.slice(0, 8).map(c => ({
        changes: engine.describeReconductor(c.changes), lengthM: c.lengthM, violations: c.totalViolations, violationsRemoved: c.violationsRemoved,
        kwhSavedPerDay: r2(c.kwhSavedPerDay), capexLkr: c.capex === null ? 'not set (no conductor cost in the design)' : Math.round(c.capex)
      }));
      const result = { baselineViolations: r.baseline.totalViolations, candidatesEvaluated: Math.min(r.candidateCount, clampInt(inp.max_candidates, 1, 80, 40)), candidateCount: r.candidateCount, conductorsConsidered: r.conductorsConsidered, top };
      const best = r.candidates[0];
      if (!best || (best.violationsRemoved <= 0 && best.kwhSavedPerDay <= 0)) return { result: capResult(result) };
      return { result: capResult(result), proposal: { tool: name, title: `Reconductor ${engine.describeReconductor(best.changes)}`, summary: `Violations ${r.baseline.totalViolations} → ${best.totalViolations}; saves ${r2(best.kwhSavedPerDay)} kWh/day`, patch: engine.designPatch(design, engine.applyReconductor(design, best.changes)) } };
    }
    case 'fault_levels': {
      const f = engine.faultLevels(design);
      return { result: capResult({
        transformers: f.transformers.map(t => ({ id: t.id, ik3MaxKA: r2(t.ik3MaxA / 1000), ik1MinA: Math.round(t.ik1MinA) })),
        polesLowestIk1First: f.poles.map(p => ({ pole: p.id, distanceM: p.distanceM, ik3MaxKA: r2(p.ik3MaxA / 1000), ik1MinA: Math.round(p.ik1MinA) })).sort((a, b) => a.ik1MinA - b.ik1MinA)
      }) };
    }
    case 'hosting_capacity': {
      const rows = engine.computeHostingCapacity(design);
      const list = rows.map(h => ({ pole: h.pole, phase: h.phase, kva: r2(h.kva), limit: h.limit || null, detail: h.limitDetail || null })).sort((a, b) => a.kva - b.kva);
      return { result: capResult({ capKva: design.maxpv, locations: list.length, leastFirst: list }) };
    }
    default: throw new Error(`Unknown tool "${name}".`);
  }
}

module.exports = { TOOL_DEFS, TOOL_NAMES, runEngineTool, capResult, MAX_RESULT_CHARS };
