import assert from 'node:assert/strict'
import punycode, { decode, encode, toASCII, toUnicode, ucs2, version } from 'node:punycode'

import { ReadableStream, TextDecoderStream, TextEncoderStream, TransformStream, WritableStream } from 'node:stream/web'

for (const value of ['mañana', 'bücher', '☃-⌘']) {
  assert.equal(decode(encode(value)), value)
  assert.equal(toUnicode(toASCII(`${value}.example`)), `${value}.example`)
}
assert.equal(version, '2.1.0')
assert.equal(punycode.encode('bücher'), 'bcher-kva')
assert.deepEqual(ucs2.decode('A😀'), [65, 128512])
assert.equal(ucs2.encode([65, 128512]), 'A😀')

assert.equal(typeof ReadableStream, 'function')
assert.equal(typeof WritableStream, 'function')
assert.equal(typeof TransformStream, 'function')
assert.equal(typeof TextDecoderStream, 'function')
assert.equal(typeof TextEncoderStream, 'function')

const stream = new ReadableStream({ start(controller) { controller.enqueue('ok'); controller.close() } })
const reader = stream.getReader()
assert.deepEqual(await reader.read(), { done: false, value: 'ok' })
assert.deepEqual(await reader.read(), { done: true, value: undefined })

console.log('punycode and stream/web ok')
