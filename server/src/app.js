// The Express app, built from a repository (src/repo/mysql.js in production, an in-memory one in
// tests) so routes are tested end to end without a database.
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { authRoutes } = require('./routes/auth');
const { designRoutes } = require('./routes/designs');
const { orgRoutes } = require('./routes/orgs');
const { aiRoutes } = require('./routes/ai');

function createApp({ repo, rateLimits = true, ai = null } = {}) {
  const app = express();

  // The nginx container in front of this one sets X-Forwarded-For; without this, express-rate-limit
  // can't safely derive the real client IP and logs a validation error on every request.
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({ origin: process.env.FRONTEND_ORIGIN, credentials: true }));
  app.use(cookieParser());
  app.use(express.json({ limit: '600kb' }));

  // Generous global limit, plus a tighter one on auth (brute force) and AI (cost control).
  const pass = (req, res, next) => next();
  const limit = (o) => (rateLimits ? rateLimit(o) : pass);
  app.use(limit({ windowMs: 60 * 1000, max: 120 }));
  const authLimiter = limit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'Too many attempts — try again later.' } });
  const aiLimiter = limit({ windowMs: 60 * 60 * 1000, max: 30, message: { error: 'AI insights rate limit reached — try again later.' } });

  // Login/register/logout are rate-limited; the session endpoints (me, sessions) are not, so the
  // app's own checks don't eat into the brute-force budget.
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/register', authLimiter);
  app.use('/api/auth', authRoutes(repo));
  app.use('/api/designs', designRoutes(repo));
  app.use('/api/orgs', orgRoutes(repo));
  app.use('/api/ai', aiLimiter, (ai || aiRoutes)(repo));

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  // Central error handler: never leak internals to the client.
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large.' });
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON.' });
    console.error(err);
    res.status(500).json({ error: 'Internal server error.' });
  });
  return app;
}

module.exports = { createApp };
