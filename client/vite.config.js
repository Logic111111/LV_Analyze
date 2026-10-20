import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// The engine is the shared package in ../packages/engine (P7.1).
const ENGINE = fileURLToPath(new URL('../packages/engine/index.js', import.meta.url));

export default defineConfig({
  plugins: [react()],
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
