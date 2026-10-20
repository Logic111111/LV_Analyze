// MySQL repository: every database access the routes need, in one place, with parameterised SQL
// only. Routes depend on this interface, not on the pool, so their tests run against the
// in-memory implementation in test/memoryRepo.js (P7.4: "mock repo layer").
//
// Multi-statement changes (a design save plus its version row) run in a transaction.
function createMysqlRepo(pool) {
  const one = async (sql, params) => { const [rows] = await pool.query(sql, params); return rows[0] || null; };
  const all = async (sql, params) => { const [rows] = await pool.query(sql, params); return rows; };
  const json = (v) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);
  const withTx = async (fn) => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const out = await fn(conn);
      await conn.commit();
      return out;
    } catch (e) {
      await conn.rollback().catch(() => {});
      throw e;
    } finally {
      conn.release();
    }
  };
  const designRow = (r) => (r ? {
    id: r.id, userId: r.user_id, ownerEmail: r.owner_email, name: r.name, txRating: r.tx_rating,
    data: json(r.data), summary: json(r.summary), summaryUpdatedAt: r.summary_updated_at,
    orgId: r.org_id ?? null, orgName: r.org_name ?? null, status: r.status || 'draft',
    currentVersion: r.current_version ?? 0, lockedVersion: r.locked_version ?? null, updatedAt: r.updated_at
  } : null);
  const DESIGN_COLS = `d.id, d.user_id, u.email AS owner_email, d.name, d.tx_rating, d.summary, d.summary_updated_at,
    d.org_id, o.name AS org_name, d.status, d.current_version, d.locked_version, d.updated_at`;
  const DESIGN_FROM = 'designs d JOIN users u ON u.id = d.user_id LEFT JOIN organisations o ON o.id = d.org_id';

  return {
    // ---- users ----
    findUserByEmail: (email) => one('SELECT id, email, password_hash FROM users WHERE email = ?', [email]),
    findUserById: (id) => one('SELECT id, email FROM users WHERE id = ?', [id]),
    async createUser(email, passwordHash) {
      const [r] = await pool.query('INSERT INTO users (email, password_hash) VALUES (?, ?)', [email, passwordHash]);
      return r.insertId;
    },

    // ---- sessions (P7.5) ----
    createSession: ({ jti, userId, expiresAt, userAgent }) =>
      pool.query('INSERT INTO sessions (jti, user_id, expires_at, user_agent) VALUES (?, ?, ?, ?)', [jti, userId, expiresAt, (userAgent || '').slice(0, 255)]),
    async getSession(jti) {
      const r = await one('SELECT jti, user_id, expires_at, revoked_at FROM sessions WHERE jti = ?', [jti]);
      return r && { jti: r.jti, userId: r.user_id, expiresAt: new Date(r.expires_at), revokedAt: r.revoked_at ? new Date(r.revoked_at) : null };
    },
    revokeSession: (jti) => pool.query('UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE jti = ? AND revoked_at IS NULL', [jti]),
    revokeAllSessions: (userId) => pool.query('UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL', [userId]),
    async listSessions(userId) {
      const rows = await all('SELECT jti, created_at, expires_at, user_agent FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP ORDER BY created_at DESC', [userId]);
      return rows.map(r => ({ jti: r.jti, createdAt: r.created_at, expiresAt: r.expires_at, userAgent: r.user_agent }));
    },

    // ---- designs ----
    // Everything the user can open: their own, and any shared with an organisation they're in.
    async listAccessibleDesigns(userId) {
      const rows = await all(`SELECT ${DESIGN_COLS} FROM ${DESIGN_FROM}
        WHERE d.user_id = ? OR d.org_id IN (SELECT org_id FROM memberships WHERE user_id = ?)
        ORDER BY d.updated_at DESC`, [userId, userId]);
      return rows.map(designRow);
    },
    async getDesign(id) {
      return designRow(await one(`SELECT ${DESIGN_COLS}, d.data FROM ${DESIGN_FROM} WHERE d.id = ?`, [id]));
    },
    findDesignByName: (userId, name) => one('SELECT id FROM designs WHERE user_id = ? AND name = ?', [userId, name]),
    // A new design and its first version, atomically.
    createDesign: ({ userId, name, txRating, data, summary, note }) => withTx(async (c) => {
      const [r] = await c.query(
        `INSERT INTO designs (user_id, name, tx_rating, data, summary, summary_updated_at, current_version)
         VALUES (?, ?, ?, ?, ?, ${summary ? 'CURRENT_TIMESTAMP' : 'NULL'}, 1)`,
        [userId, name, txRating, JSON.stringify(data), summary ? JSON.stringify(summary) : null]);
      await c.query('INSERT INTO design_versions (design_id, version, data, note, created_by) VALUES (?, 1, ?, ?, ?)', [r.insertId, JSON.stringify(data), note || null, userId]);
      return { id: r.insertId, version: 1 };
    }),
    // A new version of an existing design (the design row follows it), atomically. `status`
    // optionally changes the workflow state at the same time (an edit to an approved design
    // reopens it as a draft).
    saveDesignVersion: ({ designId, userId, txRating, data, summary, note, status }) => withTx(async (c) => {
      const [[cur]] = await c.query('SELECT current_version FROM designs WHERE id = ? FOR UPDATE', [designId]);
      const version = Number(cur.current_version) + 1;
      await c.query('INSERT INTO design_versions (design_id, version, data, note, created_by) VALUES (?, ?, ?, ?, ?)', [designId, version, JSON.stringify(data), note || null, userId]);
      await c.query(
        `UPDATE designs SET tx_rating = ?, data = ?, current_version = ?${summary ? ', summary = ?, summary_updated_at = CURRENT_TIMESTAMP' : ''}${status ? ', status = ?' : ''} WHERE id = ?`,
        [txRating, JSON.stringify(data), version, ...(summary ? [JSON.stringify(summary)] : []), ...(status ? [status] : []), designId]);
      return { version };
    }),
    deleteDesign: async (id) => { const [r] = await pool.query('DELETE FROM designs WHERE id = ?', [id]); return r.affectedRows; },
    setDesignOrg: (id, orgId) => pool.query('UPDATE designs SET org_id = ? WHERE id = ?', [orgId, id]),
    setDesignStatus: (id, status, lockedVersion) => pool.query('UPDATE designs SET status = ?, locked_version = ? WHERE id = ?', [status, lockedVersion, id]),

    // ---- versions (P7.3) ----
    async listVersions(designId) {
      const rows = await all(`SELECT v.version, v.note, v.created_at, u.email AS created_by_email
        FROM design_versions v LEFT JOIN users u ON u.id = v.created_by WHERE v.design_id = ? ORDER BY v.version DESC`, [designId]);
      return rows.map(r => ({ version: r.version, note: r.note, createdAt: r.created_at, createdBy: r.created_by_email }));
    },
    async getVersion(designId, version) {
      const r = await one('SELECT version, data, note, created_at FROM design_versions WHERE design_id = ? AND version = ?', [designId, version]);
      return r && { version: r.version, data: json(r.data), note: r.note, createdAt: r.created_at };
    },

    // ---- organisations, roles (P7.4) ----
    createOrg: ({ name, adminUserId }) => withTx(async (c) => {
      const [r] = await c.query('INSERT INTO organisations (name) VALUES (?)', [name]);
      await c.query('INSERT INTO memberships (user_id, org_id, role) VALUES (?, ?, ?)', [adminUserId, r.insertId, 'admin']);
      return r.insertId;
    }),
    async listUserOrgs(userId) {
      const rows = await all('SELECT o.id, o.name, m.role FROM memberships m JOIN organisations o ON o.id = m.org_id WHERE m.user_id = ? ORDER BY o.name', [userId]);
      return rows.map(r => ({ id: r.id, name: r.name, role: r.role }));
    },
    async getMembership(userId, orgId) {
      const r = await one('SELECT role FROM memberships WHERE user_id = ? AND org_id = ?', [userId, orgId]);
      return r ? { role: r.role } : null;
    },
    upsertMember: (orgId, userId, role) => pool.query('INSERT INTO memberships (user_id, org_id, role) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE role = VALUES(role)', [userId, orgId, role]),
    removeMember: (orgId, userId) => pool.query('DELETE FROM memberships WHERE org_id = ? AND user_id = ?', [orgId, userId]),
    async listMembers(orgId) {
      const rows = await all('SELECT u.id, u.email, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = ? ORDER BY u.email', [orgId]);
      return rows.map(r => ({ userId: r.id, email: r.email, role: r.role }));
    },
    insertReview: ({ designId, version, action, comment, userId }) =>
      pool.query('INSERT INTO design_reviews (design_id, version, action, comment, user_id) VALUES (?, ?, ?, ?, ?)', [designId, version, action, comment, userId]),
    async listReviews(designId) {
      const rows = await all(`SELECT r.version, r.action, r.comment, r.created_at, u.email FROM design_reviews r LEFT JOIN users u ON u.id = r.user_id
        WHERE r.design_id = ? ORDER BY r.id DESC`, [designId]);
      return rows.map(r => ({ version: r.version, action: r.action, comment: r.comment, createdAt: r.created_at, by: r.email, userId: undefined }));
    },
    async lastSubmitter(designId) {
      const r = await one("SELECT user_id FROM design_reviews WHERE design_id = ? AND action = 'submit' ORDER BY id DESC LIMIT 1", [designId]);
      return r ? r.user_id : null;
    },
    insertAudit: ({ userId, orgId, designId, version, action, detail }) =>
      pool.query('INSERT INTO audit_log (user_id, org_id, design_id, version, action, detail) VALUES (?, ?, ?, ?, ?, ?)', [userId ?? null, orgId ?? null, designId ?? null, version ?? null, action, detail ? JSON.stringify(detail) : null]),
    async listAudit(orgId, limit = 200) {
      const rows = await all(`SELECT a.id, a.action, a.design_id, a.version, a.detail, a.created_at, u.email FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
        WHERE a.org_id = ? ORDER BY a.id DESC LIMIT ?`, [orgId, Math.min(1000, Math.max(1, Number(limit) || 200))]);
      return rows.map(r => ({ id: r.id, action: r.action, designId: r.design_id, version: r.version, detail: json(r.detail), createdAt: r.created_at, by: r.email }));
    }
  };
}

module.exports = { createMysqlRepo };
