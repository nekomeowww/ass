import assert from 'node:assert/strict'
import { crc32, createGzip, gunzip, gzip } from 'node:zlib'
import { Readable } from 'node:stream'
import { buffer } from 'node:stream/consumers'

const compressed = await new Promise((resolve, reject) => gzip('hello zlib', (error, value) => error ? reject(error) : resolve(value)))
const decompressed = await new Promise((resolve, reject) => gunzip(compressed, (error, value) => error ? reject(error) : resolve(value)))
assert.equal(String(decompressed), 'hello zlib')
assert.equal(crc32('hello'), 907060870)

const stream = Readable.from(['stream gzip']).pipe(createGzip())
const streamCompressed = await buffer(stream)
const streamDecompressed = await new Promise((resolve, reject) => gunzip(streamCompressed, (error, value) => error ? reject(error) : resolve(value)))
assert.equal(String(streamDecompressed), 'stream gzip')

console.log('zlib web codecs ok')
