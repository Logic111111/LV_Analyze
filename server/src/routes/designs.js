const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { can } = require('../access');
const { loadEngine } = require('../engine');

const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const MAX_DESIGN_BYTES = 500 * 1024; // generous headroom for a network with hundreds of poles
const MAX_SUMMARY_BYTES = 8 * 1024;
const MAX_COMMENT = 2000;
const MAX_FIELD_RECORDS = 2000;

function validateDesign(design) {
  if (!design || typeof design !== 'object' || Array.isArray(design)) return 'Design payload missing.';
  if (typeof design.name !== 'string' || !design.name.trim() || design.name.length > 255) {
    return 'Design name is required (max 255 characters).';
  }
  if (!Array.isArray(design.transformers) || !design.transformers.length) return 'transformers must be a non-empty array.';
  if (!design.transformers.every(t => Number.isFinite(t.txRating))) return 'Every transformer needs a numeric txRating.';
  if (!Array.isArray(design.poles)) return 'poles must be an array.';
  if (JSON.stringify(design).length > MAX_DESIGN_BYTES) return 'Design payload is too large.';
  return null;
}

// The fleet-dashboard summary (P6.5) is the client's; it is kept only if it is a small plain object.
function cleanSummary(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  return JSON.stringify(s).length <= MAX_SUMMARY_BYTES ? s : null;
}

// Rounded to an integer: the `tx_rating` column is INT, and under MySQL's default strict SQL
// mode inserting a non-integer (e.g. a fractional rating from a hand-edited/imported design)
// throws instead of truncating — round defensively so a save never fails over a display-only
// summary figure.
function totalRatingKva(design) {
  return Math.round(design.transformers.reduce((sum, t) => sum + t.txRating, 0));
}

const idParam = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const commentOf = (body) => (body && typeof body.comment === 'string' ? body.comment.trim() : '');

function designRoutes(repo) {
  const router = express.Router();
  router.use(requireAuth(repo));

  // Loads the design and the user's membership in its organisation, and checks `action`.
  // Responds 404 (not 403) when the user can't even read it, so ids of others' designs leak nothing.
  async function load(req, res, action) {
    const id = idParam(req.params.id);
    if (!id) { res.status(400).json({ error: 'Invalid id.' }); return null; }
    const design = await repo.getDesign(id);
    const membership = design && design.orgId ? await repo.getMembership(req.user.id, design.orgId) : null;
    if (!design || !can('read', { design, userId: req.user.id, membership })) { res.status(404).json({ error: 'Design not found.' }); return null; }
    const lastSubmitterId = action === 'approve' ? await repo.lastSubmitter(id) : null;
    if (action !== 'read' && !can(action, { design, userId: req.user.id, membership, lastSubmitterId })) {
      const why = action === 'edit' && design.status === 'submitted' ? 'This design is under review — it can be changed again once it is approved or rejected.'
        : action === 'approve' && Number(lastSubmitterId) === Number(req.user.id) ? 'You submitted this design, so someone else has to approve it.'
          : 'You do not have permission to do that.';
      res.status(action === 'edit' && design.status === 'submitted' ? 409 : 403).json({ error: why });
      return null;
    }
    return { design, membership };
  }
  const audit = (req, design, action, detail) => repo.insertAudit({ userId: req.user.id, orgId: design.orgId || null, designId: design.id, version: design.currentVersion, action, detail });
  const meta = (design, req, membership) => ({
    status: design.status, orgId: design.orgId, orgName: design.orgName, currentVersion: design.currentVersion, lockedVersion: design.lockedVersion,
    own: Number(design.userId) === Number(req.user.id), ownerEmail: design.ownerEmail, role: membership ? membership.role : null,
    canEdit: can('edit', { design, userId: req.user.id, membership })
  });

  // Every design the user can open (own and shared with their organisations), with the summary.
  router.get('/', ah(async (req, res) => {
    const rows = await repo.listAccessibleDesigns(req.user.id);
    res.json({
      designs: rows.map(d => ({
        id: d.id, name: d.name, txRating: d.txRating, updatedAt: d.updatedAt, summary: d.summary, summaryUpdatedAt: d.summaryUpdatedAt,
        status: d.status, orgId: d.orgId, orgName: d.orgName, ownerEmail: d.ownerEmail, own: Number(d.userId) === Number(req.user.id), currentVersion: d.currentVersion
      }))
    });
  }));

  router.get('/:id', ah(async (req, res) => {
    const r = await load(req, res, 'read');
    if (!r) return;
    res.json({ design: { id: r.design.id, updatedAt: r.design.updatedAt, ...r.design.data }, meta: meta(r.design, req, r.membership) });
  }));

  // Save. Body: the design, plus optional __summary (P6.5), __note (version note) and __designId
  // (save into that design — needed for a design shared by someone else). Without __designId a
  // design is saved by name among the user's own, overwriting one with the same name. Every save
  // is a new version (P7.3); saving an approved design keeps that version locked and reopens the
  // design as a draft.
  router.post('/', ah(async (req, res) => {
    const { __summary, __note, __designId, ...design } = req.body || {};
    const err = validateDesign(design);
    if (err) return res.status(400).json({ error: err });
    const note = typeof __note === 'string' ? __note.slice(0, 500) : null;
    const summary = cleanSummary(__summary);
    const txRating = totalRatingKva(design);
    let targetId = __designId != null ? idParam(__designId) : null;
    if (__designId != null && !targetId) return res.status(400).json({ error: 'Invalid design id.' });
    if (!targetId) { const own = await repo.findDesignByName(req.user.id, design.name); targetId = own ? own.id : null; }
    if (!targetId) {
      try {
        const { id, version } = await repo.createDesign({ userId: req.user.id, name: design.name, txRating, data: design, summary, note });
        await repo.insertAudit({ userId: req.user.id, designId: id, version, action: 'design.create', detail: { name: design.name } });
        return res.status(201).json({ id, version, overwritten: false });
      } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'You already have a design with that name.' });
        throw e;
      }
    }
    req.params.id = String(targetId);
    const r = await load(req, res, 'edit');
    if (!r) return;
    const reopen = ['approved', 'rejected'].includes(r.design.status) ? 'draft' : undefined;
    const { version } = await repo.saveDesignVersion({ designId: targetId, userId: req.user.id, txRating, data: design, summary, note, status: reopen });
    await audit(req, { ...r.design, currentVersion: version }, 'design.save', reopen ? { reopened: r.design.status } : null);
    res.json({ id: targetId, version, overwritten: true, status: reopen || r.design.status });
  }));

  router.delete('/:id', ah(async (req, res) => {
    const r = await load(req, res, 'delete');
    if (!r) return;
    await repo.deleteDesign(r.design.id);
    await audit(req, r.design, 'design.delete', { name: r.design.name });
    res.json({ ok: true });
  }));

  // ---- version history (P7.3) ----
  router.get('/:id/versions', ah(async (req, res) => {
    const r = await load(req, res, 'read');
    if (!r) return;
    res.json({ versions: await repo.listVersions(r.design.id), currentVersion: r.design.currentVersion, lockedVersion: r.design.lockedVersion });
  }));
  router.get('/:id/versions/:v', ah(async (req, res) => {
    const r = await load(req, res, 'read');
    if (!r) return;
    const v = await repo.getVersion(r.design.id, idParam(req.params.v));
    if (!v) return res.status(404).json({ error: 'Version not found.' });
    res.json({ version: v });
  }));
  router.post('/:id/versions/:v/restore', ah(async (req, res) => {
    const r = await load(req, res, 'edit');
    if (!r) return;
    const v = await repo.getVersion(r.design.id, idParam(req.params.v));
    if (!v) return res.status(404).json({ error: 'Version not found.' });
    const reopen = ['approved', 'rejected'].includes(r.design.status) ? 'draft' : undefined;
    const out = await repo.saveDesignVersion({ designId: r.design.id, userId: req.user.id, txRating: totalRatingKva(v.data), data: v.data, summary: null, note: `Restored version ${v.version}`, status: reopen });
    await audit(req, { ...r.design, currentVersion: out.version }, 'design.restore', { from: v.version });
    res.json({ id: r.design.id, version: out.version });
  }));
  router.post('/:id/duplicate', ah(async (req, res) => {
    const r = await load(req, res, 'read');
    if (!r) return;
    const base = (typeof (req.body || {}).name === 'string' && req.body.name.trim() ? req.body.name.trim() : `${r.design.name} (copy)`).slice(0, 240);
    let name = base, n = 2;
    while (await repo.findDesignByName(req.user.id, name)) name = `${base} ${n++}`;
    const data = { ...r.design.data, name };
    const { id, version } = await repo.createDesign({ userId: req.user.id, name, txRating: r.design.txRating, data, summary: r.design.summary, note: `Duplicated from "${r.design.name}" v${r.design.currentVersion}` });
    await repo.insertAudit({ userId: req.user.id, designId: id, version, action: 'design.duplicate', detail: { from: r.design.id } });
    res.status(201).json({ id, name });
  }));

  // ---- sharing and the approval workflow (P7.4) ----
  router.post('/:id/share', ah(async (req, res) => {
    const r = await load(req, res, 'share');
    if (!r) return;
    const orgId = req.body && req.body.orgId != null ? idParam(req.body.orgId) : null;
    if (req.body && req.body.orgId != null && !orgId) return res.status(400).json({ error: 'Invalid organisation.' });
    if (orgId && !(await repo.getMembership(req.user.id, orgId))) return res.status(403).json({ error: 'You can only share with an organisation you belong to.' });
    if (['submitted', 'approved'].includes(r.design.status) && orgId !== r.design.orgId) return res.status(409).json({ error: 'A design under review or approved stays with its organisation.' });
    await repo.setDesignOrg(r.design.id, orgId);
    await audit(req, { ...r.design, orgId: orgId || r.design.orgId }, orgId ? 'design.share' : 'design.unshare', { orgId });
    res.json({ ok: true, orgId });
  }));
  const transition = (action, to, needsComment = true) => ah(async (req, res) => {
    const comment = commentOf(req.body);
    if (needsComment && !comment) return res.status(400).json({ error: 'A comment is required.' });
    if (comment.length > MAX_COMMENT) return res.status(400).json({ error: `Comments are limited to ${MAX_COMMENT} characters.` });
    const r = await load(req, res, action);
    if (!r) return;
    const locked = to === 'approved' ? r.design.currentVersion : r.design.lockedVersion;
    await repo.setDesignStatus(r.design.id, to, locked);
    await repo.insertReview({ designId: r.design.id, version: r.design.currentVersion, action, comment, userId: req.user.id });
    await audit(req, r.design, `design.${action}`, { comment });
    res.json({ ok: true, status: to, lockedVersion: locked });
  });
  router.post('/:id/submit', transition('submit', 'submitted'));
  router.post('/:id/approve', transition('approve', 'approved'));
  router.post('/:id/reject', transition('reject', 'rejected'));
  router.get('/:id/reviews', ah(async (req, res) => {
    const r = await load(req, res, 'read');
    if (!r) return;
    res.json({ reviews: await repo.listReviews(r.design.id), status: r.design.status });
  }));

  // ---- field survey sync (P7.8) ----
  // Body: { baseVersion, records } — the version the phone downloaded and what was recorded on it.
  // Records whose connection hasn't changed since baseVersion are applied as one new version;
  // the rest come back as conflicts with the current values (engine fieldSurvey.js). The save is
  // conditional on the version read here, so a save that lands in between is caught (409, retry).
  router.post('/:id/field-sync', ah(async (req, res) => {
    const body = req.body || {};
    const baseVersion = idParam(body.baseVersion);
    if (!baseVersion) return res.status(400).json({ error: 'baseVersion is required.' });
    if (!Array.isArray(body.records) || !body.records.length) return res.status(400).json({ error: 'records must be a non-empty list.' });
    if (body.records.length > MAX_FIELD_RECORDS) return res.status(400).json({ error: `At most ${MAX_FIELD_RECORDS} records per sync.` });
    const engine = await loadEngine();
    for (let i = 0; i < body.records.length; i++) {
      const e = engine.fieldRecordError(body.records[i]);
      if (e) return res.status(400).json({ error: `Record ${i + 1}: ${e}.` });
    }
    const r = await load(req, res, 'edit');
    if (!r) return;
    const current = r.design.currentVersion;
    if (baseVersion > current) return res.status(400).json({ error: 'baseVersion is newer than the design.' });
    const base = baseVersion === current ? null : await repo.getVersion(r.design.id, baseVersion);
    if (baseVersion !== current && !base) return res.status(400).json({ error: 'baseVersion not found.' });
    const records = body.records.map(x => ({ kind: x.kind, id: x.id, observedPhase: x.observedPhase ?? null, meterId: x.meterId ?? null, note: x.note ?? null, photoRef: x.photoRef ?? null, recordedAt: x.recordedAt, force: x.force === true }));
    const merged = engine.mergeFieldRecords(base ? base.data : null, r.design.data, records);
    if (!merged.applied.length) return res.json({ id: r.design.id, version: current, applied: [], conflicts: merged.conflicts });
    const reopen = ['approved', 'rejected'].includes(r.design.status) ? 'draft' : undefined;
    try {
      const out = await repo.saveDesignVersion({ designId: r.design.id, userId: req.user.id, txRating: totalRatingKva(merged.design), data: merged.design, summary: null,
        note: `Field survey: ${merged.applied.length} connection${merged.applied.length === 1 ? '' : 's'}${baseVersion !== current ? ` (recorded on v${baseVersion})` : ''}`, status: reopen, expectVersion: current });
      await audit(req, { ...r.design, currentVersion: out.version }, 'design.fieldSync', { applied: merged.applied.length, conflicts: merged.conflicts.length, baseVersion });
      res.json({ id: r.design.id, version: out.version, applied: merged.applied, conflicts: merged.conflicts });
    } catch (e) {
      if (e && e.code === 'VERSION_CONFLICT') return res.status(409).json({ error: 'The design was saved by someone else during the sync — sync again.' });
      throw e;
    }
  }));

  return router;
}

module.exports = { designRoutes, validateDesign };
