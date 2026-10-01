import assert from 'node:assert/strict'
import { PassThrough, Readable, Transform, Writable, isReadable, isWritable } from 'node:stream'
import { buffer, bytes, json, text } from 'node:stream/consumers'
import { pipeline } from 'node:stream/promises'

assert.equal(isReadable(Readable.from(['a'])), true)
assert.equal(isWritable(new Writable()), true)
assert.equal(await text(Readable.from(['hello', ' ', 'stream'])), 'hello stream')
assert.deepEqual(await json(Readable.from(['{"answer":42}'])), { answer: 42 })
assert.deepEqual([...await bytes(Readable.from([new Uint8Array([1, 2, 3])]))], [1, 2, 3])
assert.equal((await buffer(Readable.from(['ok']))).toString(), 'ok')

const output = []
const transform = new Transform({ transform(chunk, _encoding, callback) { callback(null, String(chunk).toUpperCase()) } })
const writable = new Writable({ write(chunk, _encoding, callback) { output.push(String(chunk)); callback() } })
await pipeline(Readable.from(['a', 'b']), transform, writable)
assert.deepEqual(output, ['A', 'B'])

const pass = new PassThrough()
const collected = text(pass)
pass.write('pass')
pass.end()
assert.equal(await collected, 'pass')

const flowing = new Readable({ read() {} })
flowing.on('data', () => {})
flowing.push('delivered')
await new Promise(resolve => setTimeout(resolve, 0))
assert.equal(flowing.read(), null)
flowing.push(null)

console.log('stream family ok')
