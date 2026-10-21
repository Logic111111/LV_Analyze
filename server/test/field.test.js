// P7.8 — field survey sync: records made on a downloaded version are applied as a new version,
// with conflict detection by design version, and the usual access rules.
process.env.JWT_SECRET = 'test-secret-not-for-production';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { createMemoryRepo } = require('./memoryRepo');

const design = () => ({
  name: 'Field island', transformers: [{ id: 'TX', txRating: 100 }],
  poles: [{ id: 'P1', parent: 'TX', feeder: 'F1', spanM: 40, cond: '70ABC' }],
  loads: [{ id: 'L1', pole: 'P1', type: 'general', phase: 'A', kva: null }, { id: 'L2', pole: 'P1', type: 'general', phase: 'B', kva: null }],
  pv: [{ id: 'S1', pole: 'P1', phase: 'C', kva: 3 }], bess: []
});

async function setup() {
  const repo = createMemoryRepo();
  const app = createApp({ repo, rateLimits: false });
  const user = async (email) => {
    const agent = request.agent(app);
    assert.equal((await agent.post('/api/auth/register').send({ email, password: 'password123' })).status, 201);
    return agent;
  };
  const owner = await user('owner@example.test');
  const saved = await owner.post('/api/designs').send(design());
  assert.equal(saved.status, 201);
  return { repo, app, user, owner, id: saved.body.id };
}
const rec = (id, extra = {}) => ({ kind: id.startsWith('S') ? 'pv' : 'load', id, recordedAt: '2026-10-21T08:30:00Z', ...extra });

test('records on the current version are applied as a new version', async () => {
  const { owner, id } = await setup();
  const r = await owner.post(`/api/designs/${id}/field-sync`).send({ baseVersion: 1, records: [rec('L1', { observedPhase: 'C', meterId: ' M-001 ', note: 'meter behind gate' }), rec('S1', { photoRef: 'IMG_2041.jpg' })] });
  assert.equal(r.status, 200);
  assert.equal(r.body.version, 2);
  assert.deepEqual(r.body.applied.map(a => a.id), ['L1', 'S1']);
  assert.deepEqual(r.body.conflicts, []);
  const d = (await owner.get(`/api/designs/${id}`)).body.design;
  const l1 = d.loads.find(l => l.id === 'L1');
  assert.deepEqual([l1.phase, l1.meterId, l1.fieldNote, l1.surveyedAt], ['C', 'M-001', 'meter behind gate', '2026-10-21T08:30:00Z']);
  assert.equal(d.pv[0].photoRef, 'IMG_2041.jpg');
  assert.equal(d.pv[0].phase, 'C'); // no observed phase → unchanged
  const versions = (await owner.get(`/api/designs/${id}/versions`)).body.versions;
  assert.equal(versions[0].note, 'Field survey: 2 connections');
});

test('a connection changed since the base version is a conflict; force applies it; removed ones are reported', async () => {
  const { owner, id } = await setup();
  // The designer moves L2 to phase C (v2) and removes S1 (v2 too).
  const d2 = { ...design(), loads: design().loads.map(l => (l.id === 'L2' ? { ...l, phase: 'C' } : l)), pv: [] };
  assert.equal((await owner.post('/api/designs').send({ ...d2, __designId: id })).status, 200);
  // A phone that downloaded v1 recorded L1 (unchanged since), L2 (changed) and S1 (removed).
  const r = await owner.post(`/api/designs/${id}/field-sync`).send({ baseVersion: 1, records: [rec('L1', { meterId: 'M-1' }), rec('L2', { observedPhase: 'A' }), rec('S1', { meterId: 'M-3' })] });
  assert.equal(r.status, 200);
  assert.equal(r.body.version, 3);
  assert.deepEqual(r.body.applied.map(a => a.id), ['L1']);
  assert.deepEqual(r.body.conflicts, [
    { kind: 'load', id: 'L2', reason: 'changed', server: { pole: 'P1', phase: 'C', meterId: null } },
    { kind: 'pv', id: 'S1', reason: 'removed', server: null }
  ]);
  const forced = await owner.post(`/api/designs/${id}/field-sync`).send({ baseVersion: 1, records: [rec('L2', { observedPhase: 'A', force: true })] });
  assert.equal(forced.body.version, 4);
  assert.equal((await owner.get(`/api/designs/${id}`)).body.design.loads.find(l => l.id === 'L2').phase, 'A');
  // Nothing applicable → no new version.
  const none = await owner.post(`/api/designs/${id}/field-sync`).send({ baseVersion: 1, records: [rec('S1', { meterId: 'x' })] });
  assert.equal(none.body.version, 4);
  assert.deepEqual(none.body.applied, []);
});

test('validation, access rules and the version race', async () => {
  const { repo, owner, user, id } = await setup();
  const bad = async (body) => (await owner.post(`/api/designs/${id}/field-sync`).send(body)).status;
  assert.equal(await bad({ records: [rec('L1')] }), 400);
  assert.equal(await bad({ baseVersion: 1, records: [] }), 400);
  assert.equal(await bad({ baseVersion: 1, records: [rec('L1', { observedPhase: 'D' })] }), 400);
  assert.equal(await bad({ baseVersion: 1, records: [rec('L1', { note: 'x'.repeat(201) })] }), 400);
  assert.equal(await bad({ baseVersion: 1, records: [{ kind: 'pole', id: 'P1' }] }), 400);
  assert.equal(await bad({ baseVersion: 9, records: [rec('L1')] }), 400);
  assert.equal(await bad({ baseVersion: 1, records: Array.from({ length: 2001 }, () => rec('L1')) }), 400);
  const stranger = await user('stranger@example.test');
  assert.equal((await stranger.post(`/api/designs/${id}/field-sync`).send({ baseVersion: 1, records: [rec('L1')] })).status, 404);
  assert.equal((await request(createApp({ repo, rateLimits: false })).post(`/api/designs/${id}/field-sync`).send({})).status, 401);
  // Someone saves between the read and the write → 409, nothing written.
  const save = repo.saveDesignVersion;
  repo.saveDesignVersion = async (args) => { await save({ ...args, expectVersion: undefined, note: 'someone else' }); return save(args); };
  const raced = await owner.post(`/api/designs/${id}/field-sync`).send({ baseVersion: 1, records: [rec('L1', { meterId: 'M-1' })] });
  repo.saveDesignVersion = save;
  assert.equal(raced.status, 409);
  const versions = (await owner.get(`/api/designs/${id}/versions`)).body.versions;
  assert.equal(versions[0].note, 'someone else');
});
