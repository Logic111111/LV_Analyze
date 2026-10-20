// node --test (built in; no dependencies). P1.3 fix 5: the AI Insights model comes from
// ANTHROPIC_MODEL, defaulting to the model the app has always used.
const test = require('node:test');
const assert = require('node:assert/strict');
const { anthropicModel, DEFAULT_ANTHROPIC_MODEL } = require('../src/config');

test('defaults to the historical model when ANTHROPIC_MODEL is unset', () => {
  assert.equal(DEFAULT_ANTHROPIC_MODEL, 'claude-sonnet-4-6');
  assert.equal(anthropicModel({}), 'claude-sonnet-4-6');
});

test('treats an empty or blank value as unset (docker-compose passes "" through)', () => {
  assert.equal(anthropicModel({ ANTHROPIC_MODEL: '' }), 'claude-sonnet-4-6');
  assert.equal(anthropicModel({ ANTHROPIC_MODEL: '   ' }), 'claude-sonnet-4-6');
});

test('uses ANTHROPIC_MODEL when set, trimmed', () => {
  assert.equal(anthropicModel({ ANTHROPIC_MODEL: 'claude-opus-5-5' }), 'claude-opus-5-5');
  assert.equal(anthropicModel({ ANTHROPIC_MODEL: ' claude-sonnet-5-5\n' }), 'claude-sonnet-5-5');
});

test('the AI route no longer hard-codes a model id', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/routes/ai.js'), 'utf8');
  assert.doesNotMatch(src, /model:\s*'claude-/);
  assert.match(src, /anthropicModel\(\)/);
});
