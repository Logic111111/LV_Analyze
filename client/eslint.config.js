import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

// The load-flow engine (packages/engine, P7.1) is linted by eslint.engine.config.js, which
// enforces its purity rule; here only the client's one-line re-export of it remains.
const ENGINE_FILES = ['src/lib/loadflow.js'];

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
    languageOptions: { globals: { ...globals.es2021 } }
  },
  {
    // The service worker template (P7.8); __PRECACHE__ is filled in at build time.
    files: ['pwa/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.serviceworker, __PRECACHE__: 'readonly' } }
  },
  {
    files: ['src/**/__tests__/**', 'scripts/**', 'vite.config.js', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node } }
  }
];
