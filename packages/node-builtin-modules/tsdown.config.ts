import type { UserConfig } from 'tsdown'

import { defineConfig } from 'tsdown'

import { builtinEntries } from './scripts/module-registry.ts'
import { nodeBuiltinsPlugin } from './scripts/node-builtins-plugin.ts'

const config: UserConfig = {
  clean: true,
  dts: false,
  entry: builtinEntries,
  format: 'esm',
  minify: true,
  outDir: './dist',
  outputOptions: {
    codeSplitting: true,
    entryFileNames: '[name].mjs',
  },
  platform: 'browser',
  plugins: [nodeBuiltinsPlugin()],
  sourcemap: false,
  target: 'es2022',
}

export default defineConfig(config)
