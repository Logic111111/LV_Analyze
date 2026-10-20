require('dotenv').config();
const pool = require('./db');
const { createApp } = require('./app');
const { createMysqlRepo } = require('./repo/mysql');
const { runMigrations } = require('./migrate');

// Migrations first (P7.2): the app never serves requests against an older schema.
async function main() {
  await runMigrations(pool);
  const app = createApp({ repo: createMysqlRepo(pool) });
  const port = process.env.PORT || 4000;
  app.listen(port, () => console.log(`Feeder Island API listening on :${port}`));
}

main().catch(e => { console.error('Start-up failed:', e.message); process.exit(1); });
