// The shared engine (packages/engine, P7.1) is pure ES modules; this CommonJS server loads it with
// a dynamic import(), once. The path is the same in the repository and in the Docker image
// (/app/server/src → /app/packages/engine), so nothing is copied or bundled.
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ENGINE_ENTRY = path.join(__dirname, '..', '..', 'packages', 'engine', 'index.js');
let enginePromise = null;

function loadEngine() {
  if (!enginePromise) enginePromise = import(pathToFileURL(ENGINE_ENTRY).href);
  return enginePromise;
}

module.exports = { loadEngine, ENGINE_ENTRY };
