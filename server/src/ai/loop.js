// The AI Insights tool loop (P7.7): the model asks for engine tools, the server runs them on the
// design the client sent, and the model writes its brief from those results only. Bounded by a
// round limit, an overall deadline (each tool call also has its own), and size caps on everything
// sent to the model. It never saves: proposals go back to the client, which previews them.
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { TOOL_DEFS, TOOL_NAMES } = require('./tools');

const MAX_ROUNDS = 8;
const DEADLINE_MS = 120000;
const TOOL_TIMEOUT_MS = 45000;
const MAX_TOKENS = 8000;

const SYSTEM = `You are a distribution planning engineer reviewing a low-voltage island (415/240 V, Dyn11 transformers, 4-wire unbalanced load flow) in a design tool. You have tools that run the tool's own engine on the engineer's design.

Rules:
- Ground every number and every claim about this network in a tool result from this conversation. If you have not run a tool that shows it, do not state it — run the tool or say it was not checked.
- Never invent engineering or commercial data (costs, tariffs, fuse data, inverter settings). When a tool says a value is "not set", say so.
- Rooftop PV is grid-tied and reverse power flow is permitted; transformer loading is a limit only when importing. Voltage rise under export is still checked against the statutory band.
- Some tools return a proposal_id. Proposals are previews the engineer can open in the app; nothing is applied or saved. Refer to a proposal as [proposal P1] (with its id) when you recommend it.
- Use few tool calls: a snapshot or daily scan first, then only the advisors that address what you found.

Write the final brief directly to the engineer, concise (about 250–400 words), covering: overall health in one line; the most important issues with poles/phases/hours; practical mitigations ranked by likely cost-effectiveness, citing proposals; one forward-looking note on load growth.`;

// Adaptive thinking exists on the 4.6 generation and later; older model ids (still selectable via
// ANTHROPIC_MODEL) would reject the parameter, so it is only sent where it is supported.
function supportsAdaptiveThinking(model) {
  return /^claude-(opus|sonnet)-4-[6-9]/.test(model) || /^claude-[a-z]+-[5-9]/.test(model);
}

/** Runs one engine tool in a worker thread, with a time limit. */
function runToolInWorker(name, input, design, timeoutMs = TOOL_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const w = new Worker(path.join(__dirname, 'toolWorker.js'), { workerData: { name, input, design } });
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); w.terminate(); } };
    const timer = setTimeout(() => done({ ok: false, error: `The tool took longer than ${Math.round(timeoutMs / 1000)} s and was stopped.` }), timeoutMs);
    w.once('message', done);
    w.once('error', (e) => done({ ok: false, error: String(e && e.message || e) }));
    w.once('exit', (code) => done({ ok: false, error: `The tool stopped unexpectedly (exit ${code}).` }));
  });
}

function designOverview(design) {
  const count = (k) => (Array.isArray(design[k]) ? design[k].length : 0);
  return {
    name: design.name || 'Untitled',
    transformers: (design.transformers || []).map(t => ({ id: t.id, kva: t.txRating, tap: t.tap })),
    poles: count('poles'), loads: count('loads'), pv: count('pv'), bess: count('bess'),
    vnom: design.vnom, voltageBandPct: design.vdev, growthPctPerYear: design.growth
  };
}

/**
 * @param {{ client: any, model: string, design: any, question?: string, runTool?: Function, maxRounds?: number, deadlineMs?: number, now?: () => number }} p
 * @returns {Promise<{ text: string, toolsRun: any[], proposals: any[], rounds: number, stopReason: string, model: string }>}
 */
async function runInsights({ client, model, design, question, runTool = runToolInWorker, maxRounds = MAX_ROUNDS, deadlineMs = DEADLINE_MS, now = Date.now }) {
  const start = now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deadlineMs);
  const toolsRun = [];
  const proposals = [];
  const ask = (question && question.trim()) || 'Review this island and recommend practical mitigations.';
  /** @type {any[]} */
  const messages = [{ role: 'user', content: `Design overview: ${JSON.stringify(designOverview(design))}\n\nEngineer's request: ${ask}` }];
  const params = { model, max_tokens: MAX_TOKENS, system: SYSTEM, tools: TOOL_DEFS, ...(supportsAdaptiveThinking(model) ? { thinking: { type: 'adaptive' } } : {}) };
  let rounds = 0, stopReason = 'end_turn', text = '';
  try {
    for (;;) {
      const response = await client.messages.create({ ...params, messages }, { signal: controller.signal });
      text = (response.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
      stopReason = response.stop_reason;
      const toolUses = (response.content || []).filter(b => b.type === 'tool_use');
      if (response.stop_reason !== 'tool_use' || !toolUses.length) break;
      if (rounds >= maxRounds) { stopReason = 'max_rounds'; break; }
      rounds++;
      messages.push({ role: 'assistant', content: response.content });
      const results = [];
      for (const tu of toolUses) {
        const t0 = now();
        let out;
        if (!TOOL_NAMES.has(tu.name)) out = { ok: false, error: `Unknown tool "${tu.name}".` };
        else if (now() - start > deadlineMs) out = { ok: false, error: 'Out of time for more tools.' };
        else out = await runTool(tu.name, tu.input || {}, design);
        let content;
        if (out.ok) {
          const result = { ...out.result };
          if (out.proposal) {
            const id = `P${proposals.length + 1}`;
            proposals.push({ id, ...out.proposal });
            result.proposal_id = id;
          }
          content = JSON.stringify(result);
        } else content = out.error;
        toolsRun.push({ name: tu.name, input: tu.input || {}, ok: !!out.ok, ms: now() - t0, ...(out.ok ? {} : { error: out.error }), ...(out.ok && out.proposal ? { proposalId: proposals[proposals.length - 1].id } : {}) });
        results.push({ type: 'tool_result', tool_use_id: tu.id, content, ...(out.ok ? {} : { is_error: true }) });
      }
      messages.push({ role: 'user', content: results });
    }
  } finally {
    clearTimeout(timer);
  }
  if (stopReason === 'max_rounds' && !text) text = `Stopped after ${maxRounds} rounds of tool calls without a final brief. The tools that ran are listed below.`;
  if (stopReason === 'max_tokens') text += '\n\n(The brief was cut off at the length limit.)';
  if (stopReason === 'refusal') text = text || 'The model declined to answer this request.';
  return { text: text || 'No response received.', toolsRun, proposals, rounds, stopReason, model };
}

module.exports = { runInsights, runToolInWorker, supportsAdaptiveThinking, MAX_ROUNDS, DEADLINE_MS, TOOL_TIMEOUT_MS, SYSTEM };
