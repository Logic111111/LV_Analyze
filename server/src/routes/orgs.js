const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { ROLES } = require('../access');

// Organisations and roles (P7.4). Anyone can create an organisation (becoming its admin); admins
// add and remove members and set roles, and read the organisation's audit log. Every route checks
// membership; ids of organisations the user isn't in answer 404.
const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const idParam = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

function orgRoutes(repo) {
  const router = express.Router();
  router.use(requireAuth(repo));

  async function member(req, res, adminOnly = false) {
    const orgId = idParam(req.params.id);
    if (!orgId) { res.status(400).json({ error: 'Invalid id.' }); return null; }
    const m = await repo.getMembership(req.user.id, orgId);
    if (!m) { res.status(404).json({ error: 'Organisation not found.' }); return null; }
    if (adminOnly && m.role !== 'admin') { res.status(403).json({ error: 'Only an organisation admin can do that.' }); return null; }
    return { orgId, role: m.role };
  }

  router.get('/', ah(async (req, res) => res.json({ orgs: await repo.listUserOrgs(req.user.id) })));

  router.post('/', ah(async (req, res) => {
    const name = typeof (req.body || {}).name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > 255) return res.status(400).json({ error: 'Organisation name is required (max 255 characters).' });
    try {
      const id = await repo.createOrg({ name, adminUserId: req.user.id });
      await repo.insertAudit({ userId: req.user.id, orgId: id, action: 'org.create', detail: { name } });
      res.status(201).json({ id, name, role: 'admin' });
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'An organisation with that name already exists.' });
      throw e;
    }
  }));

  router.get('/:id/members', ah(async (req, res) => {
    const m = await member(req, res);
    if (!m) return;
    res.json({ members: await repo.listMembers(m.orgId), role: m.role });
  }));

  router.post('/:id/members', ah(async (req, res) => {
    const m = await member(req, res, true);
    if (!m) return;
    const { email, role } = req.body || {};
    if (!ROLES.includes(role)) return res.status(400).json({ error: `Role must be one of ${ROLES.join(', ')}.` });
    const user = typeof email === 'string' ? await repo.findUserByEmail(email.trim().toLowerCase()) : null;
    if (!user) return res.status(404).json({ error: 'No account with that email — they need to register first.' });
    if (user.id === req.user.id && role !== 'admin') {
      const admins = (await repo.listMembers(m.orgId)).filter(x => x.role === 'admin');
      if (admins.length === 1) return res.status(409).json({ error: 'You are the only admin — make someone else admin first.' });
    }
    await repo.upsertMember(m.orgId, user.id, role);
    await repo.insertAudit({ userId: req.user.id, orgId: m.orgId, action: 'org.member.set', detail: { email: user.email, role } });
    res.json({ ok: true });
  }));

  router.delete('/:id/members/:userId', ah(async (req, res) => {
    const m = await member(req, res, true);
    if (!m) return;
    const userId = idParam(req.params.userId);
    if (!userId) return res.status(400).json({ error: 'Invalid user.' });
    const members = await repo.listMembers(m.orgId);
    const target = members.find(x => Number(x.userId) === userId);
    if (!target) return res.status(404).json({ error: 'Not a member.' });
    if (target.role === 'admin' && members.filter(x => x.role === 'admin').length === 1) return res.status(409).json({ error: 'An organisation needs at least one admin.' });
    await repo.removeMember(m.orgId, userId);
    await repo.insertAudit({ userId: req.user.id, orgId: m.orgId, action: 'org.member.remove', detail: { email: target.email } });
    res.json({ ok: true });
  }));

  router.get('/:id/audit', ah(async (req, res) => {
    const m = await member(req, res, true);
    if (!m) return;
    res.json({ audit: await repo.listAudit(m.orgId, Number(req.query.limit) || 200) });
  }));

  return router;
}

module.exports = { orgRoutes };
