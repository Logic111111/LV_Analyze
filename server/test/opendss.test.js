// The automatic OpenDSS check (/api/opendss/check): input checks and the summary, with a fake
// validator; and, where Python with opendssdirect.py is installed, one real run end to end.
process.env.JWT_SECRET = 'test-secret-not-for-production';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const request = require('supertest');
const { createApp } = require('../src/app');
const { opendssRoutes, SCRIPT_LINE } = require('../src/routes/opendss');
const { createMemoryRepo } = require('./memoryRepo');
const { loadEngine } = require('../src/engine');

async function signedIn(run) {
  const repo = createMemoryRepo();
  const app = createApp({ repo, rateLimits: false, opendss: run ? (r) => opendssRoutes(r, { run }) : null });
  const agent = request.agent(app);
  await agent.post('/api/auth/register').send({ email: 'a@example.test', password: 'password123' });
  return agent;
}
const snap = { year: 0, hour: 20, loadMult: 1, solarMult: 1 };

test('refuses a missing design or an out-of-range snapshot', async () => {
  const agent = await signedIn(async () => assert.fail('should not run'));
  const d = (await loadEngine()).defaultDesign();
  assert.equal((await agent.post('/api/opendss/check').send({ opts: snap })).status, 400);
  assert.equal((await agent.post('/api/opendss/check').send({ design: { ...d, transformers: [] }, opts: snap })).status, 400);
  assert.equal((await agent.post('/api/opendss/check').send({ design: d, opts: { ...snap, hour: 24 } })).status, 400);
  assert.equal((await agent.post('/api/opendss/check').send({ design: d, opts: { ...snap, loadMult: 'x' } })).status, 400);
});

test('exports the case for the validator and returns its summary with the worst points, not every point', async () => {
  let seen = null;
  const agent = await signedIn(async (base) => {
    seen = { dss: fs.readFileSync(base + '.dss', 'utf8'), app: JSON.parse(fs.readFileSync(base + '.app.json', 'utf8')) };
    return { ok: true, pass: true, voltage: { max: 0.0001, n: 2 }, points: [['P1', 'A', 230, 230.0001], ['P2', 'B', 228, 228]], currents: [['P1', 'A', 1, 1]] };
  });
  const d = (await loadEngine()).defaultDesign();
  const r = await agent.post('/api/opendss/check').send({ design: d, opts: snap });
  assert.equal(r.status, 200);
  assert.match(seen.dss, /^New Circuit\./m);
  assert.equal(seen.app.poles.length, d.poles.length);
  assert.equal(r.body.pass, true);
  assert.equal(r.body.points, undefined);
  assert.equal(r.body.currents, undefined);
  assert.deepEqual(r.body.worst.map(w => w.id), ['P1', 'P2']);
});

test('with full: true returns every point and current, and the transformer kVA either way', async () => {
  const result = { ok: true, pass: true, voltage: { max: 0.0001, n: 2 }, points: [['P1', 'A', 230, 230.0001], ['P2', 'B', 228, 228]], currents: [['P1', 'N', 1, 1]], transformers: [['TX', 50, 50.001]] };
  const agent = await signedIn(async () => result);
  const d = (await loadEngine()).defaultDesign();
  const full = await agent.post('/api/opendss/check').send({ design: d, opts: snap, full: true });
  assert.equal(full.status, 200);
  assert.deepEqual(full.body.points, result.points);
  assert.deepEqual(full.body.currents, result.currents);
  assert.deepEqual(full.body.transformers, result.transformers);
  assert.deepEqual(full.body.worst.map(w => w.id), ['P1', 'P2']);
  const brief = await agent.post('/api/opendss/check').send({ design: d, opts: snap, full: 'yes' });
  assert.equal(brief.body.points, undefined);
  assert.equal(brief.body.currents, undefined);
  assert.deepEqual(brief.body.transformers, result.transformers);
});

test('a design can\'t smuggle OpenDSS commands into the script the validator runs', async () => {
  let dss = '';
  const agent = await signedIn(async (base) => { dss = fs.readFileSync(base + '.dss', 'utf8'); return { ok: true, pass: true, points: [] }; });
  const d = (await loadEngine()).defaultDesign();
  d.name = 'x\nDOScmd calc.exe\r\nRedirect C:/secrets.dss';
  d.poles = [...d.poles, { ...d.poles[0], id: 'Q1', parent: 'ghost\nExport voltages' }];
  assert.equal((await agent.post('/api/opendss/check').send({ design: d, opts: snap })).status, 200);
  dss.split('\n').forEach(l => assert.match(l, SCRIPT_LINE));
  assert.doesNotMatch(dss.split('\n').filter(l => !l.startsWith('!')).join('\n'), /DOScmd|Redirect|Export/);
});

test('says the check is unavailable when Python or opendssdirect.py is missing', async () => {
  const missing = Object.assign(new Error('spawn python ENOENT'), { code: 'ENOENT', stderr: '' });
  const agent = await signedIn(async () => { throw missing; });
  const r = await agent.post('/api/opendss/check').send({ design: (await loadEngine()).defaultDesign(), opts: snap });
  assert.equal(r.status, 503);
  assert.match(r.body.error, /opendssdirect/);
});

const python = process.env.OPENDSS_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
let hasOpenDSS = false;
try { execFileSync(python, ['-c', 'import opendssdirect'], { stdio: 'ignore', windowsHide: true }); hasOpenDSS = true; } catch { /* not installed */ }

test('real OpenDSS agrees with the app on the default design', { skip: !hasOpenDSS && 'needs Python with opendssdirect.py' }, async () => {
  const agent = await signedIn(null);
  const r = await agent.post('/api/opendss/check').send({ design: (await loadEngine()).defaultDesign(), opts: snap });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.pass, true);
  assert.ok(r.body.voltage.max < 0.001, `max |dV| ${r.body.voltage.max} V`);
  assert.ok(r.body.voltage.n > 0 && r.body.current.n > 0);
  assert.equal(r.body.transformers.length, 1);
  const [, appKVA, dssKVA] = r.body.transformers[0];
  assert.ok(appKVA > 0, `app kVA ${appKVA}`);
  assert.ok(Math.abs(appKVA - dssKVA) < 0.01, `app ${appKVA} kVA, OpenDSS ${dssKVA} kVA`);
});
