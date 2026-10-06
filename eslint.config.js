import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/', 'node_modules/', 'test-results/', 'playwright-report/'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    // shared with Node (sync script + tests) — must not touch browser or Node APIs
    files: ['src/catalog-schema.js'],
    languageOptions: { globals: {} },
  },
  {
    files: ['scripts/**/*.mjs', 'test/**/*.mjs', '*.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    // Playwright tests run code inside the page too
    files: ['test/smoke/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
];
