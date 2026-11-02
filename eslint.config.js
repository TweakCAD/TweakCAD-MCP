/**
 * ESLint flat config for the MCP bridge. Same rule set as the CAD app's,
 * minus the React rules.
 *
 * Type-aware rules are not enabled: `tsc --noEmit` already covers the same
 * sources in `pnpm typecheck`. This config catches what the compiler
 * doesn't: `any` creeping in, stray `console.log`, `eval`, `var`.
 *
 * `no-console` is an error here, not a warning: stdout carries the MCP
 * framing, so only the stderr methods are allowed.
 */
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-non-null-assertion': 'warn',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', '**/*.js', '**/*.cjs', '**/*.mjs'],
  },
);
