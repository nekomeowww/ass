import {
  _connectionListener,
  Agent as HttpAgent,
  request as httpRequest,
} from '@ass/node-builtin-modules/http'
import { connect as tlsConnect, Server as TlsServer } from '@ass/node-builtin-modules/tls'

export class Agent extends HttpAgent {
  createConnection = tlsConnect
  defaultPort = 443
  protocol = 'https:'
}

export class Server extends TlsServer {
  constructor(options?: any, requestListener?) {
    if (typeof options === 'function') { requestListener = options; options = {} }
    super(options)
    this.on('secureConnection', socket => _connectionListener.call(this, socket))
    if (requestListener)
      this.on('request', requestListener)
  }
}

const secureOptions = (input, options: any = {}) => {
  if (typeof input === 'string' || input instanceof URL) {
    const url = input instanceof URL ? input : new URL(input)
    return [input, { ...options, createConnection: options.createConnection ?? tlsConnect, port: options.port ?? (url.port || 443), protocol: 'https:' }]
  }
  return [{ ...input, ...options, createConnection: options.createConnection ?? input?.createConnection ?? tlsConnect, port: options.port ?? input?.port ?? 443, protocol: 'https:' }, {}]
}

export const globalAgent = new Agent()
export const createServer = (options?, requestListener?) => new Server(options, requestListener)
export const request = (input, options?, callback?) => {
  if (typeof options === 'function') { callback = options; options = {} }
  const [secureInput, secureRequestOptions] = secureOptions(input, options)
  return httpRequest(secureInput, secureRequestOptions, callback)
}
export const get = (input, options?, callback?) => { const request_ = request(input, options, callback); request_.end(); return request_ }

export default { Agent, createServer, get, globalAgent, request, Server }
