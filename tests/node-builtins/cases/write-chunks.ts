import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { createConnection, createServer } from 'node:net'

const nativeCall = globalThis.__assNativeCall
let largestWrite = 0
globalThis.__assNativeCall = (name, args) => {
  if (name === 'net.write')
    largestWrite = Math.max(largestWrite, Buffer.from(args.data, 'base64').length)
  return nativeCall(name, args)
}

const length = 256 * 1024
const server = createServer((socket) => {
  let received = 0
  socket.on('data', (chunk) => {
    received += chunk.length
    if (received === length)
      socket.end()
  })
})
await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve))
const client = createConnection(server.address().port, '127.0.0.1')
client.end(Buffer.alloc(length, 0x61))
await new Promise((resolve, reject) => {
  client.once('error', reject)
  client.once('close', resolve)
})
await new Promise((resolve, reject) => server.once('error', reject).close(resolve))

assert.ok(largestWrite <= 64 * 1024, `native write chunk was ${largestWrite} bytes`)
console.log('bounded-native-write-chunks')
