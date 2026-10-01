import assert from 'node:assert/strict'
import { Socket, createSocket } from 'node:dgram'

const server = createSocket('udp4')
assert.equal(server instanceof Socket, true)
await new Promise((resolve, reject) => server.once('error', reject).bind(0, '127.0.0.1', resolve))
const client = createSocket('udp4')

server.once('message', (message, remote) => server.send(message, remote.port, remote.address))
const response = new Promise((resolve, reject) => {
  client.once('error', reject)
  client.once('message', message => resolve(String(message)))
})
await new Promise((resolve, reject) => client.send('ping', server.address().port, '127.0.0.1', error => error ? reject(error) : resolve()))
assert.equal(await response, 'ping')

await Promise.all([
  new Promise(resolve => client.close(resolve)),
  new Promise(resolve => server.close(resolve)),
])

console.log('dgram udp resources ok')
