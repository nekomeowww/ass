import assert from 'node:assert/strict'
import { createServer, get } from 'node:http'

const server = createServer((request, response) => {
  assert.equal(request.method, 'GET')
  assert.equal(request.url, '/hello?value=1')
  response.setHeader('Content-Type', 'text/plain')
  response.end('hello http')
})
await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve))
const address = server.address()
const body = await new Promise((resolve, reject) => {
  get(`http://127.0.0.1:${address.port}/hello?value=1`, (response) => {
    assert.equal(response.statusCode, 200)
    assert.equal(response.headers['content-type'], 'text/plain')
    let value = ''
    response.on('data', chunk => value += String(chunk))
    response.on('end', () => resolve(value))
  }).once('error', reject)
})
assert.equal(body, 'hello http')
await new Promise((resolve, reject) => server.once('error', reject).close(resolve))

console.log('http server and client ok')
