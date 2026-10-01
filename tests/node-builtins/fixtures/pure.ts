import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { EventEmitter, once } from 'node:events'
import { posix, win32 } from 'node:path'
import { parse, stringify } from 'node:querystring'
import { setTimeout as delay } from 'node:timers/promises'
import { format, promisify } from 'node:util'

assert.equal(Buffer.from('hello').toString('hex'), '68656c6c6f')
assert.equal(Buffer.from('aGVsbG8=', 'base64').toString(), 'hello')
assert.equal(randomUUID().length, 36)
assert.equal(posix.join('/a', '..', 'b'), '/b')
assert.equal(win32.join('C:\\a', '..', 'b'), 'C:\\b')
assert.deepStrictEqual({ ...parse('a=1&a=2') }, { a: ['1', '2'] })
assert.equal(stringify({ a: ['1', '2'] }), 'a=1&a=2')
assert.equal(format('%s:%d', 'answer', 42), 'answer:42')
assert.equal(await promisify((value, done) => done(null, value * 2))(21), 42)
const emitter = new EventEmitter()
const emitted = once(emitter, 'value')
emitter.emit('value', 42)
assert.deepStrictEqual(await emitted, [42])
await delay(1)
console.log('pure built-ins ok')
