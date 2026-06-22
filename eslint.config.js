// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.vitest-cache/**',
      '**/*.tsbuildinfo',
      '.changeset/**',
      'pnpm-lock.yaml',
      // The dashboard ships raw browser assets that run inside a
      // browser context. Lint them separately, with browser globals.
      'packages/dashboard/assets/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-process-exit': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      curly: ['error', 'multi-line'],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts', '**/tests/**/*.ts', '**/bench/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
  {
    // The dashboard assets run in a browser. Lint them with
    // browser globals and looser rules so the static assets don't
    // fail on Node.js-style rules.
    files: ['packages/dashboard/assets/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-console': 'off',
    },
  },
  prettier,
);
