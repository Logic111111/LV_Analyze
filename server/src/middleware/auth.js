const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'fi_session';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === 'true',
    sameSite: 'lax',
    maxAge: SESSION_MS,
    path: '/'
  };
}

// Sessions (P7.5): every sign-in gets a random jti, stored in the sessions table and carried in the
// JWT. A token is only accepted while its session row exists, hasn't expired and hasn't been
// revoked, so logout (this session) and "log out everywhere" (every session of the user) take
// effect immediately instead of when the token would have expired. Tokens issued before sessions
// existed carry no jti and are refused once — the user simply signs in again.
async function startSession(repo, user, req) {
  const jti = crypto.randomUUID();
  await repo.createSession({ jti, userId: user.id, expiresAt: new Date(Date.now() + SESSION_MS), userAgent: req.get('user-agent') || '' });
  return jwt.sign({ sub: user.id, email: user.email, jti }, process.env.JWT_SECRET, { expiresIn: Math.floor(SESSION_MS / 1000) });
}

function requireAuth(repo) {
  return async function requireAuthMiddleware(req, res, next) {
    const token = req.cookies[COOKIE_NAME];
    if (!token) return res.status(401).json({ error: 'Not signed in.' });
    let payload;
    try { payload = jwt.verify(token, process.env.JWT_SECRET); } catch (err) {
      return res.status(401).json({ error: 'Session expired — please sign in again.' });
    }
    try {
      const s = payload.jti ? await repo.getSession(payload.jti) : null;
      if (!s || s.revokedAt || s.expiresAt <= new Date() || Number(s.userId) !== Number(payload.sub)) {
        return res.status(401).json({ error: 'Session ended — please sign in again.' });
      }
      req.user = { id: Number(payload.sub), email: payload.email, jti: payload.jti };
      next();
    } catch (e) { next(e); }
  };
}

module.exports = { COOKIE_NAME, SESSION_MS, cookieOptions, requireAuth, startSession };
