// P7.7 — AI Insights as a tool loop: the engine tools on a real design (in worker threads), the
// loop's bounds (rounds, deadline), proposals, payload caps and auth — with a scripted stand-in
// for the Anthropic client, so no network and no API key.
process.env.JWT_SECRET = 'test-secret-not-for-production';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { createMemoryRepo } = require('./memoryRepo');
const { aiRoutes, CAPS } = require('../src/routes/ai');
const { runInsights, runToolInWorker, supportsAdaptiveThinking } = require('../src/ai/loop');
const { runEngineTool, TOOL_DEFS, MAX_RESULT_CHARS } = require('../src/ai/tools');
const { loadEngine } = require('../src/engine');

// The Walkthrough Island golden fixture (as in engine.test.js).
async function walkthrough() {
  const e = await loadEngine();
  const d = e.defaultDesign();
  d.transformers = [{ ...d.transformers[0], txRating: 100, hvActual: 10800 }];
  d.poles = d.poles.map(p => (p.id === 'P2' || p.id === 'P3') ? { ...p, spanM: 60 } : p);
  let n = d.loads.length;
  for (let i = 0; i < 5; i++) d.loads.push({ id: 'L' + (++n), pole: 'P2', type: 'general', phase: 'A', kva: null });
  for (let i = 0; i < 6; i++) d.loads.push({ id: 'L' + (++n), pole: 'P3', type: 'general', phase: 'A', kva: null });
  d.loads.push({ id: 'L' + (++n), pole: 'P3', type: 'ev', phase: 'A', kva: 7 });
  return d;
}

// A stand-in for client.messages.create: returns the scripted responses in order and records the
// requests it was given.
function scriptedClient(script) {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (params, options) => {
        calls.push({ params: JSON.parse(JSON.stringify(params)), options });
        const next = script[Math.min(calls.length - 1, script.length - 1)];
        return typeof next === 'function' ? next(params, options) : next;
      }
    }
  };
}
const toolUse = (id, name, input = {}) => ({ type: 'tool_use', id, name, input });

test('every tool runs on the golden fixture and stays within the size cap', async () => {
  const e = await loadEngine();
  const d = e.withDefaults(await walkthrough());
  for (const t of TOOL_DEFS) {
    const out = runEngineTool(e, d, t.name, t.name === 'run_snapshot' ? { hour: 20 } : {});
    assert.ok(out.result, t.name);
    assert.ok(JSON.stringify(out.result).length <= MAX_RESULT_CHARS + 200, t.name);
  }
  const snap = runEngineTool(e, d, 'run_snapshot', { hour: 20, solar_mult: 0 }).result;
  assert.equal(snap.polesLowestFirst[0].pole, 'P3');
  assert.ok(Math.abs(snap.polesLowestFirst[0].minV - 212.9) < 0.05); // the golden P3 A at 20:00
  const bal = runEngineTool(e, d, 'propose_phase_balance', {});
  assert.ok(bal.proposal && bal.proposal.patch, 'phase balance gives a proposal');
  assert.ok(bal.result.moves.length > 0);
  assert.throws(() => runEngineTool(e, d, 'propose_phase_balance', { transformer_id: 'NOPE' }), /not in the design/);
  assert.throws(() => runEngineTool(e, d, 'drop_tables', {}), /Unknown tool/);
});

test('the loop runs the tools the model asks for (in worker threads) and returns proposals', async () => {
  const design = await walkthrough();
  const client = scriptedClient([
    { stop_reason: 'tool_use', content: [{ type: 'text', text: 'Checking.' }, toolUse('t1', 'run_snapshot', { hour: 20 }), toolUse('t2', 'propose_phase_balance', {})] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'P3 A is low at 20:00; see [proposal P1].' }] }
  ]);
  const out = await runInsights({ client, model: 'claude-opus-5-5', design });
  assert.equal(out.text, 'P3 A is low at 20:00; see [proposal P1].');
  assert.equal(out.rounds, 1);
  assert.deepEqual(out.toolsRun.map(t => [t.name, t.ok]), [['run_snapshot', true], ['propose_phase_balance', true]]);
  assert.equal(out.proposals.length, 1);
  assert.equal(out.proposals[0].id, 'P1');
  assert.ok(out.proposals[0].patch.loads.upsert.length > 0);
  // Second request: the assistant turn is passed back intact, then the tool results.
  const second = client.calls[1].params.messages;
  assert.equal(second[1].role, 'assistant');
  assert.equal(second[2].content.length, 2);
  assert.match(second[2].content[1].content, /"proposal_id":"P1"/);
  assert.equal(client.calls[0].params.thinking.type, 'adaptive');
  assert.equal(client.calls[0].params.tools.length, 7);
});

test('the loop stops after the round limit, and unknown tools are reported to the model, not run', async () => {
  const client = scriptedClient([{ stop_reason: 'tool_use', content: [toolUse('x', 'run_snapshot', { hour: 1 }), toolUse('y', 'rm_rf', {})] }]);
  let ran = 0;
  const out = await runInsights({ client, model: 'claude-sonnet-4-6', design: await walkthrough(), runTool: async () => { ran++; return { ok: true, result: { fine: true } }; } });
  assert.equal(out.stopReason, 'max_rounds');
  assert.equal(out.rounds, 8);
  assert.equal(ran, 8);
  assert.equal(out.toolsRun.filter(t => t.name === 'rm_rf' && !t.ok).length, 8);
  assert.match(out.text, /Stopped after 8 rounds/);
});

test('the deadline aborts a slow model call', async () => {
  const client = scriptedClient([(params, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
  })]);
  await assert.rejects(runInsights({ client, model: 'm', design: await walkthrough(), deadlineMs: 50 }), /aborted/);
});

test('a tool that runs past its time limit is stopped', async () => {
  const e = await loadEngine();
  const out = await runToolInWorker('hosting_capacity', {}, e.defaultDesign(), 1);
  assert.equal(out.ok, false);
  assert.match(out.error, /longer than/);
});

test('adaptive thinking is only sent to models that support it', () => {
  for (const m of ['claude-opus-5-5', 'claude-sonnet-4-6', 'claude-fable-5-1', 'claude-haiku-5-5']) assert.equal(supportsAdaptiveThinking(m), true, m);
  for (const m of ['claude-3-5-sonnet-latest', 'claude-sonnet-4-5', 'claude-haiku-4-5']) assert.equal(supportsAdaptiveThinking(m), false, m);
});

test('the route: session required, payload caps, never saves', async () => {
  const repo = createMemoryRepo();
  const client = scriptedClient([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'All fine.' }] }]);
  const app = createApp({ repo, rateLimits: false, ai: (r) => aiRoutes(r, { client }) });
  assert.equal((await request(app).post('/api/ai/insights').send({})).status, 401);
  const agent = request.agent(app);
  assert.equal((await agent.post('/api/auth/register').send({ email: 'ai@example.test', password: 'password123' })).status, 201);
  assert.equal((await agent.post('/api/ai/insights').send({ summary: {} })).status, 400);
  assert.equal((await agent.post('/api/ai/insights').send({ design: { transformers: [] } })).status, 400);
  assert.equal((await agent.post('/api/ai/insights').send({ design: { transformers: [{ id: 'TX' }], poles: 'x' } })).status, 400);
  const tooMany = { transformers: [{ id: 'TX' }], poles: Array.from({ length: CAPS.poles + 1 }, (_, i) => ({ id: 'P' + i })) };
  const big = await agent.post('/api/ai/insights').send({ design: tooMany });
  assert.equal(big.status, 400);
  assert.match(big.body.error, /too large/);
  assert.equal((await agent.post('/api/ai/insights').send({ design: await walkthrough(), question: 'x'.repeat(CAPS.questionChars + 1) })).status, 400);
  const before = JSON.stringify(await repo.listAccessibleDesigns(1));
  const ok = await agent.post('/api/ai/insights').send({ design: await walkthrough(), question: 'Anything wrong?' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.text, 'All fine.');
  assert.deepEqual(ok.body.toolsRun, []);
  assert.match(client.calls[0].params.messages[0].content, /Anything wrong\?/);
  assert.equal(JSON.stringify(await repo.listAccessibleDesigns(1)), before);
});
