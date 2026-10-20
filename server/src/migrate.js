// Database migrations (P7.2): numbered SQL files in sql/migrations/ ("001_name.sql", …) applied
// once each, in order, recorded in schema_migrations. Runs at server start-up.
//
// sql/schema.sql stays the base schema for a fresh install (Docker runs it on an empty volume);
// every table or column added since goes through a migration, so an existing database (built from
// schema.sql long ago) and a fresh one end up identical.
//
// MySQL commits DDL implicitly, so a migration can't be rolled back as a whole. Each migration
// still runs inside START TRANSACTION … COMMIT (its data changes and its schema_migrations row are
// atomic), and statements that might already have been applied by an interrupted earlier run can
// carry a guard comment on the line before them, checked against information_schema:
//   -- @skip-if-column-exists  table.column
//   -- @skip-if-table-exists   table
//   -- @skip-if-index-exists   table.index
//   -- @skip-if-fk-exists      table.constraint
// A GET_LOCK advisory lock stops two server instances migrating at once.
const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'sql', 'migrations');
const LOCK_NAME = 'feeder_island_migrations';

/** Migration files, sorted by their numeric prefix. */
function listMigrations(dir = MIGRATIONS_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .map(f => /^(\d+)_([\w-]+)\.sql$/.exec(f))
    .filter(Boolean)
    .map(m => ({ version: Number(m[1]), name: m[2], file: path.join(dir, m[0]) }))
    .sort((a, b) => a.version - b.version);
}

/**
 * Statements of a migration with their guards. Statements end with ";" at the end of a line;
 * comment lines are dropped except guards, which attach to the next statement.
 */
function parseMigration(sql) {
  const out = [];
  let buf = [], guard = null;
  sql.split(/\r?\n/).forEach(line => {
    const g = /^\s*--\s*@skip-if-(column|table|index|fk)-exists\s+(\S+)\s*$/.exec(line);
    if (g) { guard = { kind: g[1], target: g[2] }; return; }
    if (/^\s*--/.test(line) || (!line.trim() && !buf.length)) return;
    buf.push(line);
    if (/;\s*$/.test(line)) {
      out.push({ sql: buf.join('\n').trim().replace(/;\s*$/, ''), guard });
      buf = []; guard = null;
    }
  });
  if (buf.join('').trim()) out.push({ sql: buf.join('\n').trim(), guard });
  return out;
}

async function guardHolds(conn, guard) {
  const [table, item] = guard.target.split('.');
  const q = {
    column: ['SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [table, item]],
    table: ['SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [table]],
    index: ['SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?', [table, item]],
    fk: ['SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?', [table, item]]
  }[guard.kind];
  const [rows] = await conn.query(q[0], q[1]);
  return rows.length > 0;
}

/**
 * Applies every pending migration. `pool` is a mysql2/promise pool (or anything with
 * getConnection() → { query, release }). Returns the versions applied.
 */
async function runMigrations(pool, { dir = MIGRATIONS_DIR, log = console.log } = {}) {
  const conn = await pool.getConnection();
  try {
    const [[lock]] = await conn.query('SELECT GET_LOCK(?, 60) AS got', [LOCK_NAME]);
    if (!lock || Number(lock.got) !== 1) throw new Error('Could not get the migration lock.');
    try {
      await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        version INT PRIMARY KEY, name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      const [rows] = await conn.query('SELECT version FROM schema_migrations');
      const done = new Set(rows.map(r => Number(r.version)));
      const applied = [];
      for (const m of listMigrations(dir)) {
        if (done.has(m.version)) continue;
        const statements = parseMigration(fs.readFileSync(m.file, 'utf8'));
        await conn.query('START TRANSACTION');
        try {
          for (const st of statements) {
            if (st.guard && await guardHolds(conn, st.guard)) continue;
            await conn.query(st.sql);
          }
          await conn.query('INSERT INTO schema_migrations (version, name) VALUES (?, ?)', [m.version, m.name]);
          await conn.query('COMMIT');
        } catch (e) {
          await conn.query('ROLLBACK').catch(() => {});
          throw new Error(`Migration ${m.version}_${m.name} failed: ${e.message}`);
        }
        applied.push(m.version);
        log(`Applied migration ${m.version}_${m.name}`);
      }
      return applied;
    } finally {
      await conn.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]).catch(() => {});
    }
  } finally {
    conn.release();
  }
}

module.exports = { runMigrations, listMigrations, parseMigration, MIGRATIONS_DIR };
