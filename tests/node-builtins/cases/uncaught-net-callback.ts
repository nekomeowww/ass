import { createConnection, createServer } from 'node:net'

const server = createServer(() => {
  throw new ReferenceError('net callback exploded')
})
server.listen(0, '127.0.0.1', () => {
  createConnection(server.address().port, '127.0.0.1')
})
