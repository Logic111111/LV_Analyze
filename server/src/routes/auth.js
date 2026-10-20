const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { cookieOptions, requireAuth, startSession, COOKIE_NAME } = require('../middleware/auth');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);

function validateCredentials(email, password) {
  if (typeof email !== 'string' || !EMAIL_RE.test(email) || email.length > 255) {
    return 'Enter a valid email address.';
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
    return 'Password must be at least 8 characters.';
  }
  return null;
}

function authRoutes(repo) {
  const router = express.Router();
  const auth = requireAuth(repo);

  router.post('/register', ah(async (req, res) => {
    const { email, password } = req.body || {};
    const err = validateCredentials(email, password);
    if (err) return res.status(400).json({ error: err });
    const e = email.toLowerCase();
    if (await repo.findUserByEmail(e)) return res.status(409).json({ error: 'An account with that email already exists.' });
    const hash = await bcrypt.hash(password, 12);
    const user = { id: await repo.createUser(e, hash), email: e };
    res.cookie(COOKIE_NAME, await startSession(repo, user, req), cookieOptions());
    res.status(201).json({ user });
  }));

  router.post('/login', ah(async (req, res) => {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    const row = await repo.findUserByEmail(email.toLowerCase());
    // Constant-shape response whether the email exists or not, to avoid user enumeration.
    const genericFail = () => res.status(401).json({ error: 'Incorrect email or password.' });
    if (!row) return genericFail();
    if (!(await bcrypt.compare(password, row.password_hash))) return genericFail();
    const user = { id: row.id, email: row.email };
    res.cookie(COOKIE_NAME, await startSession(repo, user, req), cookieOptions());
    res.json({ user });
  }));

  // Logout revokes this session (P7.5); the cookie is cleared either way.
  router.post('/logout', ah(async (req, res) => {
    const token = req.cookies[COOKIE_NAME];
    if (token) {
      try {
        const p = jwt.verify(token, process.env.JWT_SECRET);
        if (p.jti) await repo.revokeSession(p.jti);
      } catch (e) { /* an invalid or expired token has nothing to revoke */ }
    }
    res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: 0 });
    res.json({ ok: true });
  }));

  // "Log out everywhere": every session of this user, this one included.
  router.post('/logout-all', auth, ah(async (req, res) => {
    await repo.revokeAllSessions(req.user.id);
    res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: 0 });
    res.json({ ok: true });
  }));

  router.get('/sessions', auth, ah(async (req, res) => {
    const sessions = await repo.listSessions(req.user.id);
    res.json({ sessions: sessions.map(s => ({ ...s, current: s.jti === req.user.jti, jti: undefined })) });
  }));

  router.get('/me', auth, (req, res) => {
    res.json({ user: { id: req.user.id, email: req.user.email } });
  });

  return router;
}

module.exports = { authRoutes };
