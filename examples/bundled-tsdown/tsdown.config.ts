import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['./src/index.ts'],
  format: 'esm',
  fixedExtension: true,
  platform: 'browser',
  target: 'safari15',
  outDir: './dist',
  clean: true,
  deps: {
    alwaysBundle: ['lodash-es'],
    onlyBundle: ['lodash-es'],
  },
  outputOptions: {
    codeSplitting: false,
  },
})
