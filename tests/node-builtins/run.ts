import assert from 'node:assert/strict'

import { spawnSync } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const directory = new URL('./fixtures/', import.meta.url)
const fixtures = (await readdir(directory)).filter(file => file.endsWith('.ts')).sort()
const execute = (command: string, path: string) => spawnSync(command, [path], {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: { ...process.env, NODE_NO_WARNINGS: '1' },
  timeout: 20_000,
})

for (const fixture of fixtures) {
  const path = fileURLToPath(new URL(fixture, directory))
  const node = execute(process.execPath, path)
  const ass = execute(fileURLToPath(new URL('../../target/debug/ass', import.meta.url)), path)
  assert.equal(node.error, undefined, `${fixture}: Node.js execution failed`)
  assert.equal(ass.error, undefined, `${fixture}: ass execution failed`)
  assert.equal(ass.status, node.status, `${fixture}: exit status differs from Node.js`)
  assert.equal(ass.stderr, node.stderr, `${fixture}: stderr differs from Node.js`)
  assert.equal(ass.stdout.trim(), node.stdout.trim(), `${fixture}: output differs from Node.js`)
  console.log(`ok ${fixture}`)
}

const colorEnvironment: NodeJS.ProcessEnv = { ...process.env, FORCE_COLOR: '1' }
delete colorEnvironment.NO_COLOR
const colorSource = 'console.log({ answer: 42, value: true, text: \'hi\' })'
const nodeColor = spawnSync(process.execPath, ['-e', colorSource], {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: colorEnvironment,
})
const assColor = spawnSync(fileURLToPath(new URL('../../target/debug/ass', import.meta.url)), ['-e', colorSource], {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: colorEnvironment,
})
assert.equal(assColor.stdout, nodeColor.stdout, 'forced-color output differs from Node.js')
console.log('ok forced-color output')

await import('./regressions.ts')
