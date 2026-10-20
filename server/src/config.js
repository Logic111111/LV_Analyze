// Server-side settings read from the environment, kept in one place so they can be unit-tested
// without starting Express or touching the database.

// The Claude model AI Insights calls. Configurable (ANTHROPIC_MODEL) so a deployment can move to
// a newer model without a code change; the default is the model this app has always used. An
// empty value counts as unset: docker-compose passes `${ANTHROPIC_MODEL:-}` through as "" when
// the variable isn't in .env.
const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6';

function anthropicModel(env = process.env) {
  const model = typeof env.ANTHROPIC_MODEL === 'string' ? env.ANTHROPIC_MODEL.trim() : '';
  return model || DEFAULT_ANTHROPIC_MODEL;
}

module.exports = { DEFAULT_ANTHROPIC_MODEL, anthropicModel };
