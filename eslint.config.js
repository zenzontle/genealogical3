import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import { reactRefresh } from 'eslint-plugin-react-refresh';
import globals from 'globals';
import reactPackage from 'react/package.json' with { type: 'json' };
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['dist/', 'coverage/', '.perf/', '.pnpm-store/', '**/*.tsbuildinfo']),
  {
    files: ['**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}'],
    extends: [js.configs.recommended],
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  {
    files: ['**/*.{ts,mts,cts,tsx}'],
    extends: [tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
    },
  },
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    // Enforce core Hooks correctness without requiring React Compiler adoption.
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    files: ['src/**/*.{jsx,tsx}'],
    extends: [reactRefresh.configs.vite()],
    plugins: { react },
    // eslint-plugin-react's 'detect' calls context.getFilename(), which ESLint 10 removed.
    settings: { react: { version: reactPackage.version } },
    rules: { 'react/no-multi-comp': 'error' },
  },
  {
    files: [
      'eslint.config.js',
      'vite.config.ts',
      'playwright.config.ts',
      'e2e/**/*.ts',
      'scripts/**/*.{js,mjs,cjs,ts}',
      '.claude/hooks/**/*.{js,mjs}',
      'server/**/*.ts',
      'api/**/*.ts',
    ],
    languageOptions: { globals: globals.node },
  },
  prettier,
]);
