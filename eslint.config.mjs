// Started 2026-11-04: the repo had an `npm run lint` script and ESLint 9 but no config, so lint
// could never run. This begins with rules that catch real defects and pass today; add stricter
// ones as the code is cleaned up, not all at once.
import tseslint from 'typescript-eslint'

// The code has `eslint-disable … react-hooks/exhaustive-deps` comments from the editor's linting.
// ESLint fails on a disable comment for an unknown rule, so these names exist but check nothing.
const unchecked = { create: () => ({}) }

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'build/**', 'ios/**', 'node_modules/**', 'docs/**', 'scripts/**', '.vite/**', '.vite-test/**', 'data/**', 'public/**'] },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      'react-hooks': { rules: { 'exhaustive-deps': unchecked } },
      react: { rules: { 'no-danger': unchecked } },
    },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      'no-debugger': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-else-if': 'error',
      'no-duplicate-case': 'error',
      'no-unreachable': 'error',
      'no-self-assign': 'error',
      'no-self-compare': 'error',
      'no-sparse-arrays': 'error',
      'no-unsafe-finally': 'error',
      'no-cond-assign': ['error', 'except-parens'],
      'use-isnan': 'error',
      'valid-typeof': 'error',
    },
  },
)
