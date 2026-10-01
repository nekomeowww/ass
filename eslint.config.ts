import { defineConfig } from '@moeru/eslint-config'

export default defineConfig({
  masknet: false,
  perfectionist: true,
  preferArrow: true,
  sonarjs: false,
  typescript: true,
  unocss: false,
  vue: false,
}, {
  ignores: [
    '**/dist/**',
    '**/node_modules/**',
    'target/**',
  ],
}, {
  rules: {
    'antfu/import-dedupe': 'error',
    'import/order': 'off',
    'style/padding-line-between-statements': 'error',
  },
}, {
  files: ['packages/node-builtin-modules/src/modules/**/*.ts'],
  rules: {
    'eqeqeq': 'off',
    'no-console': 'off',
    'node/prefer-global/process': 'off',
    'prefer-arrow/prefer-arrow-functions': 'off',
    'regexp/no-useless-quantifier': 'off',
    'style/max-statements-per-line': 'off',
    'ts/no-use-before-define': 'off',
    'unicorn/no-new-buffer': 'off',
  },
}, {
  files: ['packages/node-builtin-modules/tests/**/*.ts'],
  rules: {
    'antfu/no-import-dist': 'off',
  },
})
