import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const originalFetch = globalThis.fetch
let lastUrl = ''
globalThis.fetch = (input, init) => {
  lastUrl = String(input)
  return originalFetch(input, init)
}
await readFile('Cargo.toml')
assert.ok(lastUrl.includes('/__ass_binary__/'))
const replay = await originalFetch(lastUrl)
assert.equal(replay.status, 404)
assert.equal((await replay.json()).code, 'EBADF')
globalThis.fetch = originalFetch
console.log('one-use binary read token')
