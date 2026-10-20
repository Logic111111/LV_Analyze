// Route tests (P7.2–P7.5, P6.5) with supertest against the real Express app, middleware and access
// rules, on an in-memory repository (no database).
process.env.JWT_SECRET = 'test-secret-not-for-production';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createApp } = require('../src/app');
const { createMemoryRepo } = require('./memoryRepo');

const design = (name, extra = {}) => ({ name, transformers: [{ id: 'TX', txRating: 100 }], poles: [], loads: [], ...extra });

function setup() {
  const repo = createMemoryRepo();
  const app = createApp({ repo, rateLimits: false });
  const user = async (email) => {
    const agent = request.agent(app);
    const r = await agent.post('/api/auth/register').send({ email, password: 'password123' });
    assert.equal(r.status, 201);
    return { agent, id: r.body.user.id, email };
  };
  return { repo, app, user };
}

test('every protected route needs a session', async () => {
  const { app } = setup();
  for (const [m, p] of [['get', '/api/designs'], ['get', '/api/designs/1'], ['post', '/api/designs'], ['delete', '/api/designs/1'], ['get', '/api/designs/1/versions'],
    ['post', '/api/designs/1/submit'], ['get', '/api/orgs'], ['post', '/api/orgs'], ['get', '/api/orgs/1/audit'], ['get', '/api/auth/me'], ['get', '/api/auth/sessions'], ['post', '/api/ai/insights']]) {
    assert.equal((await request(app)[m](p)).status, 401, `${m} ${p}`);
  }
});

test('sessions: logout revokes this session, logout-all revokes every session, tokens without a jti are refused (P7.5)', async () => {
  const { app, user } = setup();
  const a = await user('a@example.test');
  const second = request.agent(app);
  await second.post('/api/auth/login').send({ email: 'a@example.test', password: 'password123' });
  assert.equal((await a.agent.get('/api/auth/sessions')).body.sessions.length, 2);
  // Keep a copy of the first session's cookie, log out, and replay it.
  const cookieJar = a.agent.jar.getCookies({ domain: '127.0.0.1', path: '/', secure: false, script: false });
  const cookie = cookieJar.map(c => `${c.name}=${c.value}`).join('; ');
  assert.equal((await a.agent.post('/api/auth/logout')).status, 200);
  assert.equal((await request(app).get('/api/auth/me').set('Cookie', cookie)).status, 401);
  assert.equal((await second.get('/api/auth/me')).status, 200);
  await second.post('/api/auth/logout-all');
  assert.equal((await second.get('/api/auth/me')).status, 401);
  const legacy = jwt.sign({ sub: a.id, email: a.email }, process.env.JWT_SECRET, { expiresIn: '1h' });
  assert.equal((await request(app).get('/api/auth/me').set('Cookie', `fi_session=${legacy}`)).status, 401);
});

test('designs: owner only; each save is a version; restore and duplicate (P7.3); summary kept (P6.5)', async () => {
  const { user } = setup();
  const a = await user('a@example.test'), b = await user('b@example.test');
  let r = await a.agent.post('/api/designs').send({ ...design('Island'), __summary: { violations: 3, worstV: 212.9 }, __note: 'first' });
  assert.equal(r.status, 201);
  const id = r.body.id;
  assert.equal(r.body.version, 1);
  r = await a.agent.post('/api/designs').send(design('Island', { admd: 2 }));
  assert.deepEqual([r.body.id, r.body.version], [id, 2]);
  assert.equal((await b.agent.get(`/api/designs/${id}`)).status, 404);
  assert.equal((await b.agent.delete(`/api/designs/${id}`)).status, 404);
  assert.equal((await b.agent.get(`/api/designs/${id}/versions`)).status, 404);
  const list = (await a.agent.get('/api/designs')).body.designs;
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].summary, { violations: 3, worstV: 212.9 });
  assert.equal((await b.agent.get('/api/designs')).body.designs.length, 0);
  const versions = (await a.agent.get(`/api/designs/${id}/versions`)).body.versions;
  assert.deepEqual(versions.map(v => [v.version, v.note]), [[2, null], [1, 'first']]);
  assert.equal((await a.agent.get(`/api/designs/${id}/versions/1`)).body.version.data.admd, undefined);
  r = await a.agent.post(`/api/designs/${id}/versions/1/restore`);
  assert.equal(r.body.version, 3);
  assert.equal((await a.agent.get(`/api/designs/${id}`)).body.design.admd, undefined);
  r = await a.agent.post(`/api/designs/${id}/duplicate`).send({});
  assert.equal(r.status, 201);
  assert.equal(r.body.name, 'Island (copy)');
  assert.equal((await a.agent.post(`/api/designs/${id}/duplicate`).send({})).body.name, 'Island (copy) 2');
  // A huge summary is dropped, not stored.
  await a.agent.post('/api/designs').send({ ...design('Island'), __summary: { blob: 'x'.repeat(20000) } });
  assert.deepEqual((await a.agent.get('/api/designs')).body.designs.find(d => d.id === id).summary, { violations: 3, worstV: 212.9 });
});

test('input limits: invalid ids, bad payloads, too large, malformed JSON', async () => {
  const { app, user } = setup();
  const a = await user('a@example.test');
  assert.equal((await a.agent.get('/api/designs/abc')).status, 400);
  assert.equal((await a.agent.post('/api/designs').send({ name: '' })).status, 400);
  assert.equal((await a.agent.post('/api/designs').send(design('Big', { poles: Array(20000).fill({ id: 'P', spanM: 30, cond: '70ABC' }) }))).status, 413);
  assert.equal((await a.agent.post('/api/designs').set('Content-Type', 'application/json').send('{"name":')).status, 400);
  assert.equal((await a.agent.post('/api/designs').send({ ...design('X'), __designId: 'zz' })).status, 400);
  void app;
});

test('organisations: admin manages members and reads the audit log; others cannot (P7.4)', async () => {
  const { user } = setup();
  const admin = await user('admin@example.test'), d1 = await user('d1@example.test'), out = await user('out@example.test');
  const org = (await admin.agent.post('/api/orgs').send({ name: 'LECO Area 1' })).body;
  assert.equal(org.role, 'admin');
  assert.equal((await admin.agent.post('/api/orgs').send({ name: 'LECO Area 1' })).status, 409);
  assert.equal((await admin.agent.post(`/api/orgs/${org.id}/members`).send({ email: 'd1@example.test', role: 'designer' })).status, 200);
  assert.equal((await admin.agent.post(`/api/orgs/${org.id}/members`).send({ email: 'nobody@example.test', role: 'designer' })).status, 404);
  assert.equal((await admin.agent.post(`/api/orgs/${org.id}/members`).send({ email: 'd1@example.test', role: 'boss' })).status, 400);
  assert.equal((await d1.agent.post(`/api/orgs/${org.id}/members`).send({ email: 'out@example.test', role: 'designer' })).status, 403);
  assert.equal((await d1.agent.get(`/api/orgs/${org.id}/audit`)).status, 403);
  assert.equal((await out.agent.get(`/api/orgs/${org.id}/members`)).status, 404);
  assert.equal((await admin.agent.delete(`/api/orgs/${org.id}/members/${admin.id}`)).status, 409); // last admin
  const audit = (await admin.agent.get(`/api/orgs/${org.id}/audit`)).body.audit;
  assert.deepEqual(audit.map(a => a.action), ['org.member.set', 'org.create']);
});

test('sharing and the approval workflow: comments required, four-eyes, locked approved versions (P7.4)', async () => {
  const { user } = setup();
  const owner = await user('owner@example.test'), designer = await user('designer@example.test'), reviewer = await user('reviewer@example.test');
  const approver = await user('approver@example.test'), outsider = await user('outsider@example.test');
  const org = (await owner.agent.post('/api/orgs').send({ name: 'Org' })).body;
  for (const [u, role] of [[designer, 'designer'], [reviewer, 'reviewer'], [approver, 'approver']]) {
    await owner.agent.post(`/api/orgs/${org.id}/members`).send({ email: u.email, role });
  }
  const id = (await owner.agent.post('/api/designs').send(design('Feeder 7'))).body.id;
  assert.equal((await owner.agent.post(`/api/designs/${id}/submit`).send({ comment: 'ready' })).status, 403); // not shared yet
  assert.equal((await designer.agent.post(`/api/designs/${id}/share`).send({ orgId: org.id })).status, 404); // can't even see it
  assert.equal((await owner.agent.post(`/api/designs/${id}/share`).send({ orgId: org.id })).status, 200);
  assert.equal((await outsider.agent.get(`/api/designs/${id}`)).status, 404);
  assert.equal((await reviewer.agent.get(`/api/designs/${id}`)).status, 200);
  // A designer member edits through __designId; a reviewer may not edit.
  assert.equal((await designer.agent.post('/api/designs').send({ ...design('Feeder 7', { admd: 1.8 }), __designId: id })).body.version, 2);
  assert.equal((await reviewer.agent.post('/api/designs').send({ ...design('Feeder 7'), __designId: id })).status, 403);
  // Submit needs a comment; then the content is frozen during review.
  assert.equal((await designer.agent.post(`/api/designs/${id}/submit`).send({ comment: '  ' })).status, 400);
  assert.equal((await designer.agent.post(`/api/designs/${id}/submit`).send({ comment: 'Please review' })).body.status, 'submitted');
  assert.equal((await owner.agent.post('/api/designs').send(design('Feeder 7'))).status, 409);
  // Reviewer can't approve; a designer can't reject.
  assert.equal((await reviewer.agent.post(`/api/designs/${id}/approve`).send({ comment: 'ok' })).status, 403);
  assert.equal((await designer.agent.post(`/api/designs/${id}/reject`).send({ comment: 'no' })).status, 403);
  // Reject, resubmit by the approver (now the submitter), who then can't approve their own submission.
  assert.equal((await reviewer.agent.post(`/api/designs/${id}/reject`).send({ comment: 'Spans over 60 m unexplained' })).body.status, 'rejected');
  assert.equal((await approver.agent.post(`/api/designs/${id}/submit`).send({ comment: 'Explained in notes' })).status, 403); // approver isn't a designer
  assert.equal((await designer.agent.post(`/api/designs/${id}/submit`).send({ comment: 'Explained in notes' })).status, 200);
  await owner.agent.post(`/api/orgs/${org.id}/members`).send({ email: designer.email, role: 'admin' });
  assert.equal((await designer.agent.post(`/api/designs/${id}/approve`).send({ comment: 'self' })).status, 403); // four-eyes
  const ok = (await approver.agent.post(`/api/designs/${id}/approve`).send({ comment: 'Approved for construction' })).body;
  assert.deepEqual([ok.status, ok.lockedVersion], ['approved', 2]);
  // Editing an approved design starts a new draft; the approved version stays locked.
  const next = (await owner.agent.post('/api/designs').send(design('Feeder 7', { admd: 2 }))).body;
  assert.deepEqual([next.version, next.status], [3, 'draft']);
  const meta = (await owner.agent.get(`/api/designs/${id}`)).body.meta;
  assert.deepEqual([meta.status, meta.lockedVersion, meta.currentVersion], ['draft', 2, 3]);
  const reviews = (await reviewer.agent.get(`/api/designs/${id}/reviews`)).body.reviews;
  assert.deepEqual(reviews.map(r => r.action), ['approve', 'submit', 'reject', 'submit']);
  const audit = (await owner.agent.get(`/api/orgs/${org.id}/audit`)).body.audit.map(a => a.action);
  ['design.share', 'design.save', 'design.submit', 'design.reject', 'design.approve'].forEach(a => assert.ok(audit.includes(a), a));
});
