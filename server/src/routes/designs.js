const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const MAX_DESIGN_BYTES = 500 * 1024; // generous headroom for a network with hundreds of poles

function validateDesign(design) {
  if (!design || typeof design !== 'object') return 'Design payload missing.';
  if (typeof design.name !== 'string' || !design.name.trim() || design.name.length > 255) {
    return 'Design name is required (max 255 characters).';
  }
  if (!Array.isArray(design.transformers) || !design.transformers.length) return 'transformers must be a non-empty array.';
  if (!design.transformers.every(t => Number.isFinite(t.txRating))) return 'Every transformer needs a numeric txRating.';
  if (!Array.isArray(design.poles)) return 'poles must be an array.';
  if (JSON.stringify(design).length > MAX_DESIGN_BYTES) return 'Design payload is too large.';
  return null;
}

// Rounded to an integer: the `tx_rating` column is INT, and under MySQL's default strict SQL
// mode inserting a non-integer (e.g. a fractional rating from a hand-edited/imported design)
// throws instead of truncating — round defensively so a save never fails over a display-only
// summary figure.
function totalRatingKva(design) {
  return Math.round(design.transformers.reduce((sum, t) => sum + t.txRating, 0));
}

// List this user's designs (id/name/rating only — full payload fetched on demand)
router.get('/', async (req, res) => {
  const [rows] = await pool.query(
    'SELECT id, name, tx_rating AS txRating, updated_at AS updatedAt FROM designs WHERE user_id = ? ORDER BY updated_at DESC',
    [req.user.id]
  );
  res.json({ designs: rows });
});

// Fetch one design's full payload (only if it belongs to this user)
router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  try {
    const [rows] = await pool.query(
      'SELECT id, name, tx_rating AS txRating, data, updated_at AS updatedAt FROM designs WHERE id = ? AND user_id = ?',
      [id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Design not found.' });
    const row = rows[0];
    // mysql2 already decodes a JSON-typed column into an object — only parse if it came back as text.
    const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
    res.json({ design: { id: row.id, updatedAt: row.updatedAt, ...data } });
  } catch (e) {
    console.error('GET /api/designs/:id failed:', e);
    res.status(500).json({ error: 'Could not load design.' });
  }
});

// Create a new design (or overwrite one this user already owns with the same name)
router.post('/', async (req, res) => {
  const design = req.body;
  const err = validateDesign(design);
  if (err) return res.status(400).json({ error: err });

  try {
    const [existing] = await pool.query(
      'SELECT id FROM designs WHERE user_id = ? AND name = ?',
      [req.user.id, design.name]
    );
    const txRating = totalRatingKva(design);
    if (existing.length) {
      await pool.query(
        'UPDATE designs SET tx_rating = ?, data = ? WHERE id = ?',
        [txRating, JSON.stringify(design), existing[0].id]
      );
      return res.json({ id: existing[0].id, overwritten: true });
    }
    const [result] = await pool.query(
      'INSERT INTO designs (user_id, name, tx_rating, data) VALUES (?, ?, ?, ?)',
      [req.user.id, design.name, txRating, JSON.stringify(design)]
    );
    res.status(201).json({ id: result.insertId, overwritten: false });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'You already have a design with that name.' });
    console.error('POST /api/designs failed:', e);
    res.status(500).json({ error: 'Could not save design.' });
  }
});

router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid id.' });
  const [result] = await pool.query('DELETE FROM designs WHERE id = ? AND user_id = ?', [id, req.user.id]);
  if (!result.affectedRows) return res.status(404).json({ error: 'Design not found.' });
  res.json({ ok: true });
});

module.exports = router;
