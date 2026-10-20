import js from '@eslint/js';
import globals from 'globals';

// Lint for the shared engine package (packages/engine, P7.1), run from the repository root by
// `npm run lint` (ESLint only lints below its base path, so it can't be part of the client pass).
// The engine must stay pure and dependency-free so it runs unchanged in the browser, a Web Worker
// and Node (brief rule 3): ES globals only (no window/document), and only relative imports of
// other engine modules — a React, DOM or npm import is a lint error, not a code-review catch.
export default [
  js.configs.recommended,
  {
    files: ['packages/engine/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.es2021 } },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-restricted-imports': ['error', {
        patterns: [{ regex: '^[^.]', message: 'The engine must stay dependency-free: relative imports of other engine modules only.' }]
      }]
    }
  }
];
