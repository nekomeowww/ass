import { Buffer } from '@ass/node-builtin-modules/buffer'

export const webcrypto = globalThis.crypto
export const subtle = globalThis.crypto.subtle
export const randomUUID = () => globalThis.crypto.randomUUID ? globalThis.crypto.randomUUID() : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, character => (Number(character) ^ globalThis.crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> Number(character) / 4).toString(16))
export const randomFillSync = (buffer, offset = 0, size = buffer.length - offset) => { globalThis.crypto.getRandomValues(buffer.subarray(offset, offset + size)); return buffer }
export const randomBytes = (size, callback) => {
  const value = randomFillSync(Buffer.alloc(size))
  if (callback)
    queueMicrotask(() => callback(null, value))
  return value
}
export const randomFill = (buffer, offset, size, callback) => {
  if (typeof offset === 'function') { callback = offset; offset = 0; size = buffer.length }
  else if (typeof size === 'function') { callback = size; size = buffer.length - offset }
  try { const value = randomFillSync(buffer, offset, size); queueMicrotask(() => callback(null, value)) }
  catch (error) { queueMicrotask(() => callback(error)) }
}
export const randomInt = (min, max, callback) => {
  if (max === undefined || typeof max === 'function') { callback = typeof max === 'function' ? max : callback; max = min; min = 0 }
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max <= min)
    throw new RangeError('Invalid random integer range')
  const range = max - min; const limit = 0x100000000 - 0x100000000 % range; const values = new Uint32Array(1); let value
  do { globalThis.crypto.getRandomValues(values); value = values[0] } while (value >= limit)
  const result = min + value % range
  if (callback)
    queueMicrotask(() => callback(null, result))
  return result
}
export const timingSafeEqual = (a, b) => {
  if (a.byteLength !== b.byteLength)
    throw new RangeError('Input buffers must have the same byte length')
  let result = 0
  for (let index = 0; index < a.byteLength; index++) result |= a[index] ^ b[index]
  return result === 0
}
export const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto)
export const constants = {}
export const getCiphers = () => []
export const getCurves = () => []
export const getHashes = () => ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512']
export const secureHeapUsed = () => ({ min: 0, total: 0, used: 0, utilization: 0 })
export default { constants, getCiphers, getCurves, getHashes, getRandomValues, randomBytes, randomFill, randomFillSync, randomInt, randomUUID, secureHeapUsed, subtle, timingSafeEqual, webcrypto }
