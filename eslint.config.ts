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
})
