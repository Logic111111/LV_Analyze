import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

// The load-flow engine must stay pure and dependency-free so it runs unchanged in the browser, a
// Web Worker and Node (brief rule 3). These files get ES globals only (no window/document) and may
// import only other relative modules — a React, DOM or npm import there is a lint error, not a
// code-review catch. Grows to cover src/lib/engine/** once the engine is split into modules.
const ENGINE_FILES = ['src/lib/loadflow.js', 'src/lib/engine/**/*.js'];

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } }
    },
    settings: { react: { version: '18.3' } },
    plugins: { react, 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Marks variables used only in JSX as used (React 17+ JSX transform, so no React-in-scope rule).
      'react/jsx-uses-vars': 'error',
      // Reported, not blocking: pre-existing unused imports shouldn't fail CI; clean them up as we go.
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }]
    }
  },
  {
    files: ['src/**/*.{js,jsx}'],
    ignores: [...ENGINE_FILES, 'src/**/__tests__/**'],
    languageOptions: { globals: { ...globals.browser } }
  },
  {
    files: ENGINE_FILES,
    languageOptions: { globals: { ...globals.es2021 } },
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{ regex: '^[^.]', message: 'The engine must stay dependency-free: relative imports of other engine modules only.' }]
      }]
    }
  },
  {
    files: ['src/**/__tests__/**', 'scripts/**', 'vite.config.js', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node } }
  }
];
