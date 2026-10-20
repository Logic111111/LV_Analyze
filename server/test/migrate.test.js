// P7.2 — the migration runner, against a fake connection that records every query.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runMigrations, listMigrations, parseMigration, MIGRATIONS_DIR } = require('../src/migrate');

function tmpDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-mig-'));
  Object.entries(files).forEach(([f, sql]) => fs.writeFileSync(path.join(dir, f), sql));
  return dir;
}

/** A fake pool: schema_migrations rows and information_schema answers are simulated. */
function fakePool({ applied = [], existing = {} } = {}) {
  const log = [];
  const rows = applied.map(v => ({ version: v }));
  const conn = {
    async query(sql, params) {
      log.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      if (/GET_LOCK/.test(sql)) return [[{ got: 1 }]];
      if (/SELECT version FROM schema_migrations/.test(sql)) return [rows];
      if (/information_schema/.test(sql)) return [existing[params.join('.')] ? [{ 1: 1 }] : []];
      if (/INSERT INTO schema_migrations/.test(sql)) rows.push({ version: params[0] });
      if (/FAIL_HERE/.test(sql)) throw new Error('boom');
      return [[]];
    },
    release() { log.push({ sql: 'RELEASE' }); }
  };
  return { pool: { getConnection: async () => conn }, log };
}

test('parses statements, multi-line and guarded', () => {
  const st = parseMigration(`-- header comment
CREATE TABLE a (
  id INT
);
-- @skip-if-column-exists designs.summary
ALTER TABLE designs ADD COLUMN summary JSON NULL;
UPDATE x SET y = 1;
`);
  assert.equal(st.length, 3);
  assert.match(st[0].sql, /^CREATE TABLE a \(\n  id INT\n\)$/);
  assert.deepEqual(st[1].guard, { kind: 'column', target: 'designs.summary' });
  assert.equal(st[2].guard, null);
});

test('applies pending migrations in numeric order, each in a transaction with its version row', async () => {
  const dir = tmpDir({ '002_b.sql': 'CREATE TABLE b (id INT);', '001_a.sql': 'CREATE TABLE a (id INT);', 'readme.txt': 'x' });
  const { pool, log } = fakePool();
  const applied = await runMigrations(pool, { dir, log: () => {} });
  assert.deepEqual(applied, [1, 2]);
  const seq = log.map(l => l.sql).filter(s => !/information_schema|GET_LOCK|RELEASE/.test(s));
  const i = seq.indexOf('CREATE TABLE a (id INT)');
  assert.deepEqual(seq.slice(i - 1, i + 3), ['START TRANSACTION', 'CREATE TABLE a (id INT)', 'INSERT INTO schema_migrations (version, name) VALUES (?, ?)', 'COMMIT']);
  assert.ok(seq.indexOf('CREATE TABLE b (id INT)') > i);
  assert.ok(log.some(l => /RELEASE_LOCK/.test(l.sql)));
});

test('skips applied migrations and statements whose guard already holds', async () => {
  const dir = tmpDir({ '001_a.sql': 'CREATE TABLE a (id INT);', '002_b.sql': '-- @skip-if-column-exists designs.summary\nALTER TABLE designs ADD COLUMN summary JSON NULL;\nCREATE TABLE c (id INT);' });
  const { pool, log } = fakePool({ applied: [1], existing: { 'designs.summary': true } });
  const applied = await runMigrations(pool, { dir, log: () => {} });
  assert.deepEqual(applied, [2]);
  assert.ok(!log.some(l => /CREATE TABLE a/.test(l.sql)));
  assert.ok(!log.some(l => /ALTER TABLE designs/.test(l.sql)));
  assert.ok(log.some(l => /CREATE TABLE c/.test(l.sql)));
});

test('a failing migration rolls back, stops, and names itself', async () => {
  const dir = tmpDir({ '001_ok.sql': 'CREATE TABLE a (id INT);', '002_bad.sql': 'SELECT FAIL_HERE;', '003_later.sql': 'CREATE TABLE z (id INT);' });
  const { pool, log } = fakePool();
  await assert.rejects(runMigrations(pool, { dir, log: () => {} }), /Migration 2_bad failed: boom/);
  assert.ok(log.some(l => l.sql === 'ROLLBACK'));
  assert.ok(!log.some(l => /CREATE TABLE z/.test(l.sql)));
  assert.ok(log.some(l => l.sql === 'RELEASE'));
});

test('the shipped migrations are numbered uniquely and parse', () => {
  const ms = listMigrations(MIGRATIONS_DIR);
  assert.equal(new Set(ms.map(m => m.version)).size, ms.length);
  ms.forEach(m => assert.ok(parseMigration(fs.readFileSync(m.file, 'utf8')).length > 0, m.file));
});
