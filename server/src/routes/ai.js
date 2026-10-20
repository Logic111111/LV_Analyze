const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { requireAuth } = require('../middleware/auth');
const { anthropicModel } = require('../config');
const { runInsights } = require('../ai/loop');

// AI Insights (P7.7): a tool-using loop on the server. The client sends its design (and an
// optional question); the model calls engine tools (ai/tools.js) that run on that design in a
// worker thread, and answers from their results. Payload caps here, round/time caps in the loop.
// The route reads nothing from and writes nothing to the database beyond the session check —
// proposals go back to the client to preview, never saved.
const CAPS = { transformers: 50, poles: 3000, loads: 20000, pv: 5000, bess: 2000, questionChars: 1000 };

function checkDesign(design) {
  if (!design || typeof design !== 'object' || Array.isArray(design)) return 'Missing design.';
  if (!Array.isArray(design.transformers) || !design.transformers.length) return 'The design has no transformer.';
  for (const k of ['transformers', 'poles', 'loads', 'pv', 'bess']) {
    if (design[k] !== undefined && !Array.isArray(design[k])) return `design.${k} must be a list.`;
    if (Array.isArray(design[k]) && design[k].length > CAPS[k]) return `The design is too large for AI Insights (more than ${CAPS[k]} ${k}).`;
  }
  return null;
}

/**
 * @param {any} repo
 * @param {{ client?: any, runTool?: Function, deadlineMs?: number }} [opts] injectable for tests
 */
function aiRoutes(repo, opts = {}) {
  const router = express.Router();
  router.use(requireAuth(repo));
  let client = opts.client || null;

  router.post('/insights', async (req, res) => {
    if (!opts.client && !process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: 'AI Insights is not configured on this server (missing ANTHROPIC_API_KEY).' });
    }
    const body = req.body || {};
    const bad = checkDesign(body.design);
    if (bad) return res.status(400).json({ error: bad });
    if (body.question !== undefined && (typeof body.question !== 'string' || body.question.length > CAPS.questionChars)) {
      return res.status(400).json({ error: `The question must be text of at most ${CAPS.questionChars} characters.` });
    }
    if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 90000 });
    try {
      const out = await runInsights({ client, model: anthropicModel(), design: body.design, question: body.question, runTool: opts.runTool, deadlineMs: opts.deadlineMs });
      res.json(out);
    } catch (e) {
      if (e instanceof Anthropic.APIUserAbortError || (e && e.name === 'AbortError')) return res.status(504).json({ error: 'The AI request ran out of time — try a narrower question.' });
      if (e instanceof Anthropic.APIError) return res.status(502).json({ error: `Anthropic API error${e.status ? ` (${e.status})` : ''}: ${String(e.message || '').slice(0, 300)}` });
      console.error(e);
      res.status(502).json({ error: 'AI request failed.' });
    }
  });

  return router;
}

module.exports = { aiRoutes, CAPS };
