import assert from 'node:assert/strict'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const path = join(tmpdir(), `ass-binary-${process.pid}-${Date.now()}.bin`)
const input = Buffer.alloc(8 * 1024 * 1024 + 3)
for (let index = 0; index < input.length; index++)
  input[index] = index & 255
try {
  await writeFile(path, input)
  const [first, second] = await Promise.all([readFile(path), readFile(path)])
  assert.equal(Buffer.isBuffer(first), true)
  assert.equal(first.equals(input), true)
  first[0] = 99
  assert.equal(second[0], 0)
  // A second read must not serve a cached response after the file changes.
  await writeFile(path, 'updated')
  assert.equal(await readFile(path, 'utf8'), 'updated')
  await writeFile(path, '')
  assert.equal((await readFile(path)).length, 0)
}
finally {
  await rm(path, { force: true })
}
try {
  await readFile(path)
  throw new Error('missing file should reject')
}
catch (error) {
  assert.equal(error.code, 'ENOENT')
  assert.equal(error.path, path)
  // ass's existing syscall spelling is "read"; Node's is "open".
  assert.equal(typeof error.syscall, 'string')
}
console.log('binary file reads ok')
