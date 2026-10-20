// Worker thread for one AI tool call (P7.7). Engine work is synchronous and can take seconds (a
// hosting search on a large island); running it here keeps the server's event loop free for
// everyone else, and lets the caller stop a call that runs past its time limit (worker.terminate).
const { parentPort, workerData } = require('node:worker_threads');
const { loadEngine } = require('../engine');
const { runEngineTool } = require('./tools');

(async () => {
  try {
    const engine = await loadEngine();
    const design = engine.withDefaults(workerData.design);
    const out = runEngineTool(engine, design, workerData.name, workerData.input);
    parentPort.postMessage({ ok: true, ...out });
  } catch (e) {
    parentPort.postMessage({ ok: false, error: String((e && e.message) || e).slice(0, 500) });
  }
})();
