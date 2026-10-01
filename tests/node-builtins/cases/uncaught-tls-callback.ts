import { readFile } from 'node:fs/promises'
import { connect, createServer } from 'node:tls'

const fixture = await readFile('tests/node-builtins/fixtures/tls-https.ts', 'utf8')
const material = name => fixture.match(new RegExp(`const ${name} = \x60([\\s\\S]*?)\x60`))[1]
const ca = material('ca')
const cert = material('cert')
const key = material('key')

const server = createServer({ cert, key }, () => {
  throw new ReferenceError('tls callback exploded')
})
server.listen(0, '127.0.0.1', () => {
  connect({ ca, host: '127.0.0.1', port: server.address().port, servername: 'localhost' })
})
