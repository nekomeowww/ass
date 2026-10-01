import assert from 'node:assert/strict'
import { BlockList, SocketAddress, createConnection, createServer, isIP, isIPv4, isIPv6 } from 'node:net'

assert.equal(isIP('127.0.0.1'), 4)
assert.equal(isIPv4('127.0.0.1'), true)
assert.equal(isIPv6('::1'), true)
assert.equal(isIP('invalid'), 0)
assert.equal(new SocketAddress({ address: '127.0.0.1', port: 80 }).port, 80)
const blockList = new BlockList()
blockList.addSubnet('10.0.0.0', 8)
assert.equal(blockList.check('10.2.3.4'), true)
assert.equal(blockList.check('11.2.3.4'), false)

const server = createServer((socket) => {
  socket.on('data', data => socket.end(data))
})
await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve))
const address = server.address()
const client = createConnection(address.port, '127.0.0.1')
const received = await new Promise((resolve, reject) => {
  client.once('error', reject)
  client.once('data', data => resolve(String(data)))
  client.end('ping')
})
assert.equal(received, 'ping')
client.destroy()
await new Promise((resolve, reject) => server.once('error', reject).close(resolve))

const refused = await new Promise((resolve) => {
  createConnection(address.port, '127.0.0.1').once('error', resolve)
})
assert.equal(refused.code, 'ECONNREFUSED')

console.log('net tcp resources ok')
