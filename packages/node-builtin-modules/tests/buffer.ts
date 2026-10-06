/* eslint-disable no-extend-native, antfu/no-top-level-await -- Simulate an older WebView before importing its fallback implementation. */
import assert from 'node:assert/strict'

import { Buffer as NodeBuffer } from 'node:buffer'

import { Buffer } from '../dist/buffer.mjs'

const buffer = Buffer.from('a')

assert.equal(buffer.subarray(0, 1).toString(), 'a')

const checkBase64 = (Implementation: typeof Buffer) => {
  const inputs = ['', 'f', 'fo', 'foo', 'こんにちは', '\0\xFF']
  for (const input of inputs) {
    const expected = NodeBuffer.from(input)
    for (const encoding of ['base64', 'base64url']) {
      const encoded = expected.toString(encoding)
      assert.equal(Implementation.from(input).toString(encoding), encoded)
      assert.deepEqual([...Implementation.from(encoded, encoding)], [...expected])
    }
  }
  for (const input of ['Z', 'Zg', 'Zm8', ' Z m 9 v\n', '-_8=', '+/8=', 'Zm$v!v', 'Zg===ignored', 'Z=g', 'abcde', '💖Zm9v'])
    assert.deepEqual([...Implementation.from(input, 'base64')], [...NodeBuffer.from(input, 'base64')], input)
  const bytes = NodeBuffer.alloc(256 * 1024 + 2)
  for (let index = 0; index < bytes.length; index++)
    bytes[index] = index & 255
  const encoded = bytes.toString('base64')
  assert.equal(Implementation.from(bytes).toString('base64'), encoded)
  assert.deepEqual([...Implementation.from(encoded, 'base64')], [...bytes])
}

checkBase64(Buffer)
const nativeDecode = Object.getOwnPropertyDescriptor(Uint8Array, 'fromBase64')
const nativeEncode = Object.getOwnPropertyDescriptor(Uint8Array.prototype, 'toBase64')
try {
  Object.defineProperty(Uint8Array, 'fromBase64', { configurable: true, value: undefined })
  Object.defineProperty(Uint8Array.prototype, 'toBase64', { configurable: true, value: undefined })
  const { Buffer: FallbackBuffer } = await import(new URL('../dist/buffer.mjs?fallback', import.meta.url).href)
  checkBase64(FallbackBuffer)
}
finally {
  if (nativeDecode)
    Object.defineProperty(Uint8Array, 'fromBase64', nativeDecode)
  else
    Reflect.deleteProperty(Uint8Array, 'fromBase64')
  if (nativeEncode)
    Object.defineProperty(Uint8Array.prototype, 'toBase64', nativeEncode)
  else
    Reflect.deleteProperty(Uint8Array.prototype, 'toBase64')
}
