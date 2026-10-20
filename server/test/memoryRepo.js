// In-memory implementation of the repository interface (src/repo/mysql.js), for route tests: the
// routes, middleware and access rules run for real; only the database is replaced.
function createMemoryRepo() {
  const db = { users: [], sessions: [], designs: [], versions: [], orgs: [], memberships: [], reviews: [], audit: [] };
  let ids = { user: 0, design: 0, org: 0, audit: 0, review: 0 };
  const now = () => new Date();
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const orgName = (id) => (db.orgs.find(o => o.id === id) || {}).name || null;
  const view = (d) => d && ({ ...clone(d), ownerEmail: (db.users.find(u => u.id === d.userId) || {}).email, orgName: orgName(d.orgId) });
  return {
    _db: db,
    async findUserByEmail(email) { const u = db.users.find(x => x.email === email); return u ? { id: u.id, email: u.email, password_hash: u.password_hash } : null; },
    async findUserById(id) { const u = db.users.find(x => x.id === Number(id)); return u ? { id: u.id, email: u.email } : null; },
    async createUser(email, password_hash) { const id = ++ids.user; db.users.push({ id, email, password_hash }); return id; },

    async createSession({ jti, userId, expiresAt, userAgent }) { db.sessions.push({ jti, userId, expiresAt: new Date(expiresAt), revokedAt: null, userAgent, createdAt: now() }); },
    async getSession(jti) { const s = db.sessions.find(x => x.jti === jti); return s ? { ...s } : null; },
    async revokeSession(jti) { db.sessions.filter(x => x.jti === jti && !x.revokedAt).forEach(x => { x.revokedAt = now(); }); },
    async revokeAllSessions(userId) { db.sessions.filter(x => x.userId === userId && !x.revokedAt).forEach(x => { x.revokedAt = now(); }); },
    async listSessions(userId) { return db.sessions.filter(x => x.userId === userId && !x.revokedAt && x.expiresAt > now()).map(x => ({ jti: x.jti, createdAt: x.createdAt, expiresAt: x.expiresAt, userAgent: x.userAgent })); },

    async listAccessibleDesigns(userId) {
      const orgs = new Set(db.memberships.filter(m => m.userId === userId).map(m => m.orgId));
      return db.designs.filter(d => d.userId === userId || (d.orgId && orgs.has(d.orgId))).map(d => { const v = view(d); delete v.data; return v; });
    },
    async getDesign(id) { return view(db.designs.find(d => d.id === Number(id))) || null; },
    async findDesignByName(userId, name) { const d = db.designs.find(x => x.userId === userId && x.name === name); return d ? { id: d.id } : null; },
    async createDesign({ userId, name, txRating, data, summary, note }) {
      const id = ++ids.design;
      db.designs.push({ id, userId, name, txRating, data: clone(data), summary: clone(summary) || null, summaryUpdatedAt: summary ? now() : null, orgId: null, status: 'draft', currentVersion: 1, lockedVersion: null, updatedAt: now() });
      db.versions.push({ designId: id, version: 1, data: clone(data), note: note || null, createdBy: userId, createdAt: now() });
      return { id, version: 1 };
    },
    async saveDesignVersion({ designId, userId, txRating, data, summary, note, status }) {
      const d = db.designs.find(x => x.id === designId);
      const version = d.currentVersion + 1;
      db.versions.push({ designId, version, data: clone(data), note: note || null, createdBy: userId, createdAt: now() });
      Object.assign(d, { txRating, data: clone(data), currentVersion: version, updatedAt: now() });
      if (summary) Object.assign(d, { summary: clone(summary), summaryUpdatedAt: now() });
      if (status) d.status = status;
      return { version };
    },
    async deleteDesign(id) { const n = db.designs.length; db.designs = db.designs.filter(d => d.id !== Number(id)); return n - db.designs.length; },
    async setDesignOrg(id, orgId) { db.designs.find(d => d.id === id).orgId = orgId; },
    async setDesignStatus(id, status, lockedVersion) { Object.assign(db.designs.find(d => d.id === id), { status, lockedVersion }); },

    async listVersions(designId) { return db.versions.filter(v => v.designId === designId).sort((a, b) => b.version - a.version).map(v => ({ version: v.version, note: v.note, createdAt: v.createdAt, createdBy: (db.users.find(u => u.id === v.createdBy) || {}).email })); },
    async getVersion(designId, version) { const v = db.versions.find(x => x.designId === designId && x.version === Number(version)); return v ? { version: v.version, data: clone(v.data), note: v.note, createdAt: v.createdAt } : null; },

    async createOrg({ name, adminUserId }) {
      if (db.orgs.some(o => o.name === name)) { const e = new Error('dup'); e.code = 'ER_DUP_ENTRY'; throw e; }
      const id = ++ids.org; db.orgs.push({ id, name }); db.memberships.push({ userId: adminUserId, orgId: id, role: 'admin' }); return id;
    },
    async listUserOrgs(userId) { return db.memberships.filter(m => m.userId === userId).map(m => ({ id: m.orgId, name: orgName(m.orgId), role: m.role })); },
    async getMembership(userId, orgId) { const m = db.memberships.find(x => x.userId === Number(userId) && x.orgId === Number(orgId)); return m ? { role: m.role } : null; },
    async upsertMember(orgId, userId, role) { const m = db.memberships.find(x => x.userId === userId && x.orgId === orgId); if (m) m.role = role; else db.memberships.push({ userId, orgId, role }); },
    async removeMember(orgId, userId) { db.memberships = db.memberships.filter(x => !(x.orgId === orgId && x.userId === userId)); },
    async listMembers(orgId) { return db.memberships.filter(m => m.orgId === orgId).map(m => ({ userId: m.userId, email: (db.users.find(u => u.id === m.userId) || {}).email, role: m.role })); },
    async insertReview(r) { db.reviews.push({ id: ++ids.review, ...r, createdAt: now() }); },
    async listReviews(designId) { return db.reviews.filter(r => r.designId === designId).sort((a, b) => b.id - a.id).map(r => ({ version: r.version, action: r.action, comment: r.comment, createdAt: r.createdAt, by: (db.users.find(u => u.id === r.userId) || {}).email })); },
    async lastSubmitter(designId) { const r = db.reviews.filter(x => x.designId === designId && x.action === 'submit').sort((a, b) => b.id - a.id)[0]; return r ? r.userId : null; },
    async insertAudit(a) { db.audit.push({ id: ++ids.audit, ...a, createdAt: now() }); },
    async listAudit(orgId) { return db.audit.filter(a => a.orgId === orgId).sort((a, b) => b.id - a.id).map(a => ({ ...a, by: (db.users.find(u => u.id === a.userId) || {}).email })); }
  };
}

module.exports = { createMemoryRepo };
