require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const designRoutes = require('./routes/designs');
const aiRoutes = require('./routes/ai');

const app = express();

// The nginx container in front of this one sets X-Forwarded-For; without this, express-rate-limit
// can't safely derive the real client IP and logs a validation error on every request.
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_ORIGIN, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '600kb' }));

// Generous global limit, plus a tighter one on auth (brute force) and AI (cost control).
app.use(rateLimit({ windowMs: 60 * 1000, max: 120 }));
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'Too many attempts — try again later.' } });
const aiLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 30, message: { error: 'AI insights rate limit reached — try again later.' } });

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/designs', designRoutes);
app.use('/api/ai', aiLimiter, aiRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Central error handler: never leak internals to the client.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error.' });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`Feeder Island API listening on :${port}`));
