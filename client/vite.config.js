import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

// The engine is the shared package in ../packages/engine (P7.1).
const ENGINE = fileURLToPath(new URL('../packages/engine/index.js', import.meta.url));

// The service worker (P7.8): pwa/sw.template.js with the list of every built file (and the public
// icons/manifest) to precache, and a version that changes whenever that list does — hashed chunk
// names change with their content, so a new build is always a new version.
function serviceWorker() {
  const template = fileURLToPath(new URL('./pwa/sw.template.js', import.meta.url));
  const publicDir = fileURLToPath(new URL('./public', import.meta.url));
  const publicFiles = readdirSync(publicDir, { recursive: true, withFileTypes: true })
    .filter(e => e.isFile()).map(e => `${e.parentPath || e.path}/${e.name}`.slice(publicDir.length).replace(/\\/g, '/').replace(/^\/?/, '/'));
  return {
    name: 'feeder-island-service-worker',
    apply: 'build',
    generateBundle(_, bundle) {
      // index.html is emitted by Vite's own HTML plugin after this hook, so it is listed by name.
      const built = Object.keys(bundle).filter(f => !f.endsWith('.map')).map(f => '/' + f);
      const precache = ['/', '/index.html', ...built, ...publicFiles].filter((f, i, a) => a.indexOf(f) === i).sort();
      const version = createHash('sha256').update(precache.join('\n')).digest('hex').slice(0, 12);
      const source = readFileSync(template, 'utf8').replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(precache, null, 1));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    }
  };
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
  resolve: { alias: { '@feeder-island/engine': ENGINE } },
  server: {
    port: 5173,
    // The dev server may serve the engine package from outside client/.
    fs: { allow: ['..'] },
    proxy: {
      // Lets the dev server forward /api calls to the Express backend so cookies
      // work under one origin during development.
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true
      }
    }
  },
  // Vitest. The engine is plain dependency-free JS, so its tests run in a bare Node environment —
  // no jsdom — which is also what proves it still runs outside the browser.
  test: {
    include: ['src/**/__tests__/**/*.test.js'],
    environment: 'node',
    testTimeout: 60000
  }
});
