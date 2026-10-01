import type { TsdownPlugin } from 'tsdown'

import { builtinManifest } from './module-registry.ts'

const sourcePrefix = '@ass/node-builtin-modules/'

export const nodeBuiltinsPlugin = (): TsdownPlugin => ({
  generateBundle(_options, bundle) {
    const chunks = Object.values(bundle).filter(output => output.type === 'chunk')
    const sharedChunks = chunks.filter(chunk => !chunk.isEntry)
    if (sharedChunks.length) {
      this.error(
        `Node.js built-in outputs must be self-contained; unexpected shared chunks: ${sharedChunks.map(chunk => chunk.fileName).join(', ')}`,
      )
    }
    const entryFiles = new Set(chunks.map(chunk => chunk.fileName))
    const missingEntries = Object.values(builtinManifest).filter(file => !entryFiles.has(file))
    if (missingEntries.length)
      this.error(`Node.js built-in manifest entries were not emitted: ${missingEntries.join(', ')}`)
    this.emitFile({
      fileName: 'manifest.json',
      source: `${JSON.stringify(builtinManifest, null, 2)}\n`,
      type: 'asset',
    })
  },
  name: 'ass-node-builtins',
  resolveId(specifier) {
    if (!specifier.startsWith(sourcePrefix))
      return null
    const builtin = `node:${specifier.slice(sourcePrefix.length)}`
    if (!(builtin in builtinManifest))
      this.error(`Unknown ass Node.js built-in dependency: ${specifier}`)
    return { external: true, id: builtin }
  },
})
