const express = require('express');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { requireAuth } = require('../middleware/auth');
const { loadEngine } = require('../engine');

// Automatic OpenDSS cross-check of one load-flow run: the client sends the design and the snapshot
// it just solved; this exports it with the engine's openDSSCheckCase, solves it in OpenDSS through
// scripts/validate-opendss.py --single and returns the comparison. Needs Python 3 with
// opendssdirect.py on the server (OPENDSS_PYTHON names the interpreter); without it the route
// answers 503 and the app shows the check as unavailable. The Docker image installs both.
const VALIDATOR = path.join(__dirname, '..', '..', '..', 'scripts', 'validate-opendss.py');
const PYTHON = process.env.OPENDSS_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const TIMEOUT_MS = 60000;
const CAPS = { transformers: 50, poles: 3000 };
// Defence in depth on top of the exporter's own escaping (one line per statement, numbers only as
// numbers): the script may hold only the commands toOpenDSS writes, so no design value can reach
// OpenDSS as Redirect, Compile, Export, Save, DOScmd or the like.
const SCRIPT_LINE = /^(?:$|!|Clear$|Solve$|Set mode=snapshot |New (?:Circuit|Vsource|Transformer|Reactor|LineCode|Line|Load)\.)/;
const UNAVAILABLE ='The OpenDSS check isn\'t available on this server: it needs Python 3 with opendssdirect.py (pip install opendssdirect.py).';

function checkInput(design, opts) {
  if (!design || typeof design !== 'object' || Array.isArray(design)) return 'Missing design.';
  if (!Array.isArray(design.transformers) || !design.transformers.length) return 'The design has no transformer.';
  if (!Array.isArray(design.poles)) return 'design.poles must be a list.';
  for (const k of Object.keys(CAPS)) if (design[k].length > CAPS[k]) return `The design is too large for the OpenDSS check (more than ${CAPS[k]} ${k}).`;
  if (!opts || typeof opts !== 'object') return 'Missing snapshot options.';
  const { year, hour, loadMult = 1, solarMult = 1 } = opts;
  if (!Number.isInteger(year) || year < 0 || year > 100) return 'opts.year must be a whole number of years from 0 to 100.';
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return 'opts.hour must be a whole hour from 0 to 23.';
  if (![loadMult, solarMult].every(m => Number.isFinite(m) && m >= 0 && m <= 10)) return 'opts.loadMult and opts.solarMult must be numbers from 0 to 10.';
  return null;
}

/** Runs the validator on <base>.dss + <base>.app.json and resolves with its JSON result. */
function runValidator(base) {
  return new Promise((resolve, reject) => {
    execFile(PYTHON, [VALIDATOR, '--single', base], { timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(Object.assign(err, { stderr: String(stderr || '') }));
      try { resolve(JSON.parse(stdout)); } catch (e) { reject(Object.assign(e, { stderr: String(stderr || '') })); }
    });
  });
}

/** The validator's result plus the five largest voltage differences; the per-point lists only when `full`. */
function summarise(r, full = false) {
  const worst = (r.points || [])
    .map(([id, phase, app, dss]) => ({ id, phase, app, opendss: dss, diff: app - dss }))
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
    .slice(0, 5);
  const rest = { ...r };
  if (!full) { delete rest.points; delete rest.currents; }
  return { ...rest, worst };
}

/**
 * @param {any} repo
 * @param {{ run?: (base: string) => Promise<any> }} [opts] injectable for tests
 */
function opendssRoutes(repo, opts = {}) {
  const router = express.Router();
  router.use(requireAuth(repo));
  const run = opts.run || runValidator;

  router.post('/check', async (req, res, next) => {
    const { design, opts: snap } = req.body || {};
    const bad = checkInput(design, snap);
    if (bad) return res.status(400).json({ error: bad });
    let dir = null;
    try {
      const engine = await loadEngine();
      // shortcut: solves on the request thread; a design near the 3000-pole cap blocks other requests for its solve time — move to a worker (as ai/toolWorker.js) if that shows.
      const { script, app } = engine.openDSSCheckCase(engine.withDefaults(design), { year: snap.year, hour: snap.hour, loadMult: snap.loadMult ?? 1, solarMult: snap.solarMult ?? 1 });
      const odd = script.split('\n').find(l => !SCRIPT_LINE.test(l));
      if (odd !== undefined) {
        console.error('OpenDSS check refused a script line:', JSON.stringify(odd.slice(0, 200)));
        return res.status(400).json({ error: 'This design can\'t be checked: its OpenDSS export has an unexpected command.' });
      }
      dir =await fs.mkdtemp(path.join(os.tmpdir(), 'fi-opendss-'));
      const base = path.join(dir, 'case');
      await fs.writeFile(base + '.dss', script);
      await fs.writeFile(base + '.app.json', JSON.stringify(app));
      res.json(summarise(await run(base), req.body.full === true));
    } catch (e) {
      if (e && (e.code === 'ENOENT' || /No module named|can't open file/.test(e.stderr || ''))) return res.status(503).json({ error: UNAVAILABLE });
      if (e && e.killed) return res.status(504).json({ error: 'OpenDSS took too long on this design.' });
      if (e && e.stderr !== undefined) { console.error('OpenDSS check failed:', e.stderr || e.message); return res.status(502).json({ error: 'The OpenDSS check failed.' }); }
      next(e);
    } finally {
      if (dir) fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  return router;
}

module.exports = { opendssRoutes, checkInput, summarise, SCRIPT_LINE };
