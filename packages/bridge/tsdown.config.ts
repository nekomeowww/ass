import type { UserConfig } from 'tsdown'

import { defineConfig } from 'tsdown'

const shared: UserConfig = {
  clean: true,
  dts: false,
  format: 'iife',
  minify: true,
  outputOptions: {
    codeSplitting: false,
    entryFileNames: '[name].js',
  },
  platform: 'browser',
  sourcemap: false,
  target: 'safari15',
}

export default defineConfig([
  {
    ...shared,
    entry: './src/core.ts',
    outDir: './dist/core',
  },
  {
    ...shared,
    entry: './src/isolated-realm.ts',
    outDir: './dist/isolated-realm',
  },
])
