import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
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
