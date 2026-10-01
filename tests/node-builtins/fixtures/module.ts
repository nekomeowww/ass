import assert from 'node:assert/strict'
import Module, { builtinModules, constants, createRequire, getSourceMapsSupport, isBuiltin, setSourceMapsSupport, syncBuiltinESMExports } from 'node:module'

assert.equal(Module.builtinModules, builtinModules)
assert.equal(isBuiltin('fs'), true)
assert.equal(isBuiltin('node:fs'), true)
assert.equal(isBuiltin('not-a-builtin'), false)
assert.equal(builtinModules.includes('stream/web'), true)
assert.equal(constants.compileCacheStatus.ENABLED, 1)

setSourceMapsSupport(true, { generatedCode: true, nodeModules: false })
assert.equal(getSourceMapsSupport().enabled, true)
assert.equal(getSourceMapsSupport().generatedCode, true)
assert.equal(getSourceMapsSupport().nodeModules, false)
syncBuiltinESMExports()

const require = createRequire(import.meta.url)
assert.equal(typeof require, 'function')
assert.equal(typeof require.resolve, 'function')

const parent = new Module('parent')
const child = new Module('child', parent)
assert.equal(parent.children[0], child)
assert.equal(child.parent, parent)

console.log('module metadata ok')
