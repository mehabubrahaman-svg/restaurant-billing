// @ts-check
import js from '@eslint/js';
import i18next from 'eslint-plugin-i18next';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Clean Architecture dependency rule, enforced per layer:
 *   domain        → nothing
 *   application   → domain
 *   infrastructure→ domain, application
 *   contracts     → (zod only)
 *   ui            → (react only)
 *   apps          → anything except other apps
 */
const layer = (files, forbidden, message) => ({
  files,
  rules: {
    'no-restricted-imports': [
      'error',
      { patterns: forbidden.map((group) => ({ group: [group], message })) },
    ],
  },
});

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', 'docs/**', '**/*.config.*'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      eqeqeq: ['error', 'always'],
    },
  },

  layer(
    ['packages/domain/src/**'],
    ['@restroos/*', 'node:*', 'fs', 'path', 'react', 'fastify', 'better-sqlite3*', 'zod'],
    'domain must stay pure: no I/O, frameworks or other layers',
  ),
  layer(
    ['packages/application/src/**'],
    [
      '@restroos/infrastructure',
      '@restroos/contracts',
      '@restroos/ui',
      'react',
      'fastify',
      'better-sqlite3*',
    ],
    'application depends only on domain and its own ports',
  ),
  layer(
    ['packages/infrastructure/src/**'],
    ['@restroos/contracts', '@restroos/ui', 'react', 'fastify'],
    'infrastructure implements ports; HTTP and UI live in apps',
  ),
  layer(
    ['packages/contracts/src/**'],
    ['@restroos/*'],
    'contracts are shared by server and clients and must not depend on any layer',
  ),
  layer(
    ['packages/ui/src/**'],
    ['@restroos/*'],
    'ui is a presentational kit with no app knowledge',
  ),
  layer(
    ['apps/web/src/**'],
    ['@restroos/infrastructure', '@restroos/application', 'node:*', 'better-sqlite3*', 'fastify'],
    'the web app talks to the server over HTTP only',
  ),

  // Money must never be a float: ban parseFloat/toFixed in domain and server code.
  {
    files: ['packages/domain/src/**', 'packages/application/src/**', 'apps/server/src/**'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { property: 'toFixed', message: 'Use Money/Quantity, not floating-point formatting.' },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'parseFloat', message: 'Use Money.ofRupees / Quantity.of, not floats.' },
      ],
    },
  },

  // Ledgers are append-only; physical DELETE only exists in migrations.
  {
    files: ['packages/**/src/**', 'apps/**/src/**'],
    ignores: ['**/*.test.ts'], // tests attempt deletes on purpose, to prove the guards hold
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/^\\s*DELETE\\s+FROM/i]',
          message: 'Rows are never deleted. Use soft delete or a reversing entry.',
        },
        {
          selector: 'TemplateElement[value.raw=/^\\s*DELETE\\s+FROM/i]',
          message: 'Rows are never deleted. Use soft delete or a reversing entry.',
        },
      ],
    },
  },

  // Browser code
  {
    files: [
      'apps/web/src/**/*.{ts,tsx}',
      'packages/ui/src/**/*.{ts,tsx}',
      'spikes/bluetooth/web/**',
    ],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },

  // Every user-visible string in the web app goes through i18n.
  {
    files: ['apps/web/src/**/*.tsx'],
    ignores: ['**/*.test.tsx'],
    plugins: { i18next },
    rules: { 'i18next/no-literal-string': ['error', { mode: 'jsx-text-only' }] },
  },
);
