import assert from 'node:assert/strict'
import importedProcess, { arch, cwd, env, nextTick, pid, platform, version } from 'node:process'

assert.equal(importedProcess, globalThis.process)
assert.equal(arch, process.arch)
assert.equal(platform, process.platform)
assert.equal(pid, process.pid)
assert.equal(cwd(), process.cwd())
assert.equal(env.PATH, process.env.PATH)
assert.match(version, /^v\d+/)
assert.equal(typeof process.ppid, 'number')
assert.equal(typeof process.hrtime.bigint(), 'bigint')
assert.equal(process.release.name.length > 0, true)

const order = []
nextTick(() => order.push('tick'))
queueMicrotask(() => order.push('microtask'))
await new Promise(resolve => setTimeout(resolve, 0))
assert.deepStrictEqual(order, ['microtask', 'tick'])

console.log('process built-in ok')
