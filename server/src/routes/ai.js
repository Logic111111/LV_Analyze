const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { anthropicModel } = require('../config');

const router = express.Router();
router.use(requireAuth);

router.post('/insights', async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'AI Insights is not configured on this server (missing ANTHROPIC_API_KEY).' });
  }
  const summary = req.body && req.body.summary;
  if (!summary || typeof summary !== 'object') {
    return res.status(400).json({ error: 'Missing report summary.' });
  }

  const prompt = `You are a distribution planning engineer reviewing an LV (415/240V, DYn11) transformer island unbalanced load-flow study.
All rooftop PV is grid-tied and reverse power flow through the transformer/feeders is fully permitted and modelled with no export cap at the transformer/grid connection (transformer loading is only ever treated as a limitation when importing) — flowDirection "export" means island generation currently exceeds demand and power is flowing back into the grid. Feeder voltage rise under export is real and still checked against the statutory band.
Here is the computed snapshot as JSON:
${JSON.stringify(summary, null, 2)}

Give a concise engineering brief (max ~250 words) covering:
1. Overall health of the island in one line.
2. The most important issue(s), referencing specific poles/phases.
3. Concrete, practical mitigation measures (e.g. phase rebalancing, conductor upgrade, tap change, EV/solar coordination, load transfer) ranked by likely cost-effectiveness.
4. One forward-looking note tying to the 5-year growth outlook.
Write directly to the engineer, no preamble.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: anthropicModel(),
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await response.json();
    if (data.error) return res.status(502).json({ error: data.error.message || 'Anthropic API error.' });
    const text = (data.content || []).map(b => b.text || '').join('\n').trim();
    res.json({ text: text || 'No response received.' });
  } catch (e) {
    res.status(502).json({ error: 'AI request failed: ' + e.message });
  }
});

module.exports = router;
