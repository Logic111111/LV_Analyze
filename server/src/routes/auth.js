const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { signSession, cookieOptions, requireAuth, COOKIE_NAME } = require('../middleware/auth');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateCredentials(email, password) {
  if (typeof email !== 'string' || !EMAIL_RE.test(email) || email.length > 255) {
    return 'Enter a valid email address.';
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
    return 'Password must be at least 8 characters.';
  }
  return null;
}

router.post('/register', async (req, res) => {
  const { email, password } = req.body || {};
  const err = validateCredentials(email, password);
  if (err) return res.status(400).json({ error: err });

  try {
    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
    if (existing.length) return res.status(409).json({ error: 'An account with that email already exists.' });

    const hash = await bcrypt.hash(password, 12);
    const [result] = await pool.query(
      'INSERT INTO users (email, password_hash) VALUES (?, ?)',
      [email.toLowerCase(), hash]
    );
    const user = { id: result.insertId, email: email.toLowerCase() };
    const token = signSession(user);
    res.cookie(COOKIE_NAME, token, cookieOptions());
    res.status(201).json({ user });
  } catch (e) {
    console.error('POST /api/auth/register failed:', e);
    res.status(500).json({ error: 'Registration failed.' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  try {
    const [rows] = await pool.query('SELECT id, email, password_hash FROM users WHERE email = ?', [email.toLowerCase()]);
    // Constant-shape response whether the email exists or not, to avoid user enumeration.
    const genericFail = () => res.status(401).json({ error: 'Incorrect email or password.' });
    if (!rows.length) return genericFail();
    const ok = await bcrypt.compare(password, rows[0].password_hash);
    if (!ok) return genericFail();

    const user = { id: rows[0].id, email: rows[0].email };
    const token = signSession(user);
    res.cookie(COOKIE_NAME, token, cookieOptions());
    res.json({ user });
  } catch (e) {
    console.error('POST /api/auth/login failed:', e);
    res.status(500).json({ error: 'Login failed.' });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: 0 });
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
