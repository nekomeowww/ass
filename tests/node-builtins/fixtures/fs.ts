import assert from 'node:assert/strict'
import { access, readFile, rm, stat, writeFile } from 'node:fs/promises'

const path = '.ass-node-builtins-test.tmp'
try {
  await writeFile(path, 'hello from fs')
  await access(path)
  assert.equal(await readFile(path, 'utf8'), 'hello from fs')
  const info = await stat(path)
  assert.equal(info.isFile(), true)
  assert.equal(info.size, 13)
}
finally {
  await rm(path, { force: true })
}
console.log('fs built-ins ok')
