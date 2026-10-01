import type { Socket } from '@ass/node-builtin-modules/net'

import EventEmitter from '@ass/node-builtin-modules/events'

import { Buffer } from '@ass/node-builtin-modules/buffer'
import { createConnection, Server as NetServer } from '@ass/node-builtin-modules/net'
import { Readable, Writable } from '@ass/node-builtin-modules/stream'

export const METHODS = ['ACL', 'BIND', 'CHECKOUT', 'CONNECT', 'COPY', 'DELETE', 'GET', 'HEAD', 'LINK', 'LOCK', 'M-SEARCH', 'MERGE', 'MKACTIVITY', 'MKCALENDAR', 'MKCOL', 'MOVE', 'NOTIFY', 'OPTIONS', 'PATCH', 'POST', 'PROPFIND', 'PROPPATCH', 'PURGE', 'PUT', 'QUERY', 'REBIND', 'REPORT', 'SEARCH', 'SOURCE', 'SUBSCRIBE', 'TRACE', 'UNBIND', 'UNLINK', 'UNLOCK', 'UNSUBSCRIBE']
export const STATUS_CODES = { 100: 'Continue', 200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content', 301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 408: 'Request Timeout', 409: 'Conflict', 410: 'Gone', 413: 'Content Too Large', 418: 'I\'m a Teapot', 429: 'Too Many Requests', 500: 'Internal Server Error', 501: 'Not Implemented', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout' }
export const maxHeaderSize = 16 * 1024
export const WebSocket = globalThis.WebSocket
export const CloseEvent = globalThis.CloseEvent
export const MessageEvent = globalThis.MessageEvent
const unsupported = (name) => {
  const error = new Error(`${name} is not implemented by the ass HTTP/1.1 adapter`)
  throw Object.assign(error, { code: 'ERR_ASS_UNSUPPORTED' })
}

const headerNamePattern = /^[!#$%&'*+\-.^\w`|~]+$/
export const validateHeaderName = (name, label = 'Header name') => {
  if (!headerNamePattern.test(String(name)))
    throw Object.assign(new TypeError(`${label} must be a valid HTTP token [${name}]`), { code: 'ERR_INVALID_HTTP_TOKEN' })
}
export const validateHeaderValue = (name, value) => {
  if (value === undefined)
    throw Object.assign(new TypeError(`Invalid value "undefined" for header "${name}"`), { code: 'ERR_HTTP_INVALID_HEADER_VALUE' })
  if (/[\0\r\n]/.test(String(value)))
    throw Object.assign(new TypeError(`Invalid character in header content ["${name}"]`), { code: 'ERR_INVALID_CHAR' })
}

const parseHeaders = (lines) => {
  const headers = {}; const rawHeaders: string[] = []
  for (const line of lines) {
    const index = line.indexOf(':')
    if (index < 0)
      continue
    const name = line.slice(0, index).trim(); const value = line.slice(index + 1).trim(); const lower = name.toLowerCase()
    rawHeaders.push(name, value)
    if (headers[lower] === undefined)
      headers[lower] = value
    else if (lower === 'set-cookie')
      headers[lower] = [...(Array.isArray(headers[lower]) ? headers[lower] : [headers[lower]]), value]
    else
      headers[lower] += `, ${value}`
  }
  return { headers, rawHeaders }
}

export class IncomingMessage extends Readable {
  complete = false
  headers: any = {}
  httpVersion = '1.1'
  method?: string
  rawHeaders: string[] = []
  socket: Socket
  statusCode?: number
  statusMessage?: string
  url?: string
  constructor(socket) { super(); this.socket = socket }
  destroy(error?) { this.socket?.destroy(error); return super.destroy(error) }
  setTimeout(timeout, callback?) { this.socket.setTimeout(timeout, callback); return this }
}

export class OutgoingMessage extends Writable {
  _headers = new Map<string, { name: string, value: any }>()
  _headerSent = false
  socket: Socket
  get headersSent() { return this._headerSent }
  constructor(socket) {
    super()
    this.socket = socket
    this._writeImplementation = (chunk, encoding, callback) => { this._sendHeaders(); socket.write(chunk, encoding, callback) }
    this._finalImplementation = (callback) => { this._sendHeaders(); socket.end(callback) }
  }

  _headerText() { return '' }
  _sendHeaders() { if (!this._headerSent) { this._headerSent = true; this.socket.write(this._headerText()) } }
  _serializedHeaders() {
    return [...this._headers.values()].flatMap(({ name, value }) => (Array.isArray(value) ? value : [value]).map(item => `${name}: ${item}\r\n`)).join('')
  }

  addTrailers() { return unsupported('http.OutgoingMessage.addTrailers') }
  appendHeader(name, value) { const current = this.getHeader(name); return this.setHeader(name, current === undefined ? value : [...(Array.isArray(current) ? current : [current]), ...(Array.isArray(value) ? value : [value])]) }
  flushHeaders() { this._sendHeaders() }
  getHeader(name) { return this._headers.get(String(name).toLowerCase())?.value }
  getHeaderNames() { return [...this._headers.keys()] }
  getHeaders() { return Object.fromEntries([...this._headers].map(([name, entry]) => [name, entry.value])) }
  hasHeader(name) { return this._headers.has(String(name).toLowerCase()) }
  removeHeader(name) { this._headers.delete(String(name).toLowerCase()) }
  setHeader(name, value) { validateHeaderName(name); validateHeaderValue(name, value); this._headers.set(String(name).toLowerCase(), { name: String(name), value }); return this }
}

export class ServerResponse extends OutgoingMessage {
  req: IncomingMessage
  sendDate = true
  statusCode = 200
  statusMessage?: string
  constructor(request) { super(request.socket); this.req = request }
  _headerText() {
    if (!this.hasHeader('connection'))
      this.setHeader('Connection', 'close')
    return `HTTP/1.1 ${this.statusCode} ${this.statusMessage ?? STATUS_CODES[this.statusCode] ?? ''}\r\n${this._serializedHeaders()}\r\n`
  }

  writeContinue() { this.socket.write('HTTP/1.1 100 Continue\r\n\r\n') }
  writeEarlyHints(hints, callback?) { let value = 'HTTP/1.1 103 Early Hints\r\n'; for (const [name, header] of Object.entries(hints)) value += `${name}: ${header}\r\n`; this.socket.write(`${value}\r\n`, callback) }
  writeHead(statusCode, statusMessage?, headers?) {
    if (typeof statusMessage !== 'string') { headers = statusMessage; statusMessage = undefined }
    this.statusCode = statusCode
    this.statusMessage = statusMessage
    if (headers) {
      for (const [name, value] of Object.entries(headers)) this.setHeader(name, value)
    }
    this._sendHeaders()
    return this
  }
}

const normalizeRequestOptions = (input, options: any = {}) => {
  if (typeof input === 'string' || input instanceof URL) {
    const url = input instanceof URL ? input : new URL(input)
    return { ...options, auth: options.auth ?? (url.username ? `${url.username}:${url.password}` : undefined), hostname: options.hostname ?? url.hostname, path: options.path ?? `${url.pathname}${url.search}`, port: options.port ?? (url.port || 80), protocol: options.protocol ?? url.protocol }
  }
  return { ...input, ...options }
}

export class Agent extends EventEmitter {
  defaultPort = 80
  maxFreeSockets = 256
  maxSockets = Number.POSITIVE_INFINITY
  protocol = 'http:'
  destroy() {}
}

export class ClientRequest extends OutgoingMessage {
  host: string
  method: string
  path: string
  protocol: string
  constructor(input, options?, callback?) {
    if (typeof options === 'function') { callback = options; options = {} }
    const normalized = normalizeRequestOptions(input, options)
    const socket = (normalized.createConnection ?? createConnection)({ ...normalized, host: normalized.hostname ?? normalized.host ?? 'localhost', port: Number(normalized.port ?? 80) })
    super(socket)
    this.host = normalized.hostname ?? normalized.host ?? 'localhost'
    this.method = String(normalized.method ?? 'GET').toUpperCase()
    this.path = normalized.path ?? '/'
    this.protocol = normalized.protocol ?? 'http:'
    for (const [name, value] of Object.entries(normalized.headers ?? {})) this.setHeader(name, value)
    if (!this.hasHeader('host'))
      this.setHeader('Host', this.host)
    if (!this.hasHeader('connection'))
      this.setHeader('Connection', 'close')
    this._finalImplementation = (done) => { this._sendHeaders(); this.socket.write('', done) }
    socket.once('error', error => this.emit('error', error))
    this._readResponse(socket)
    if (callback)
      this.once('response', callback)
  }

  _headerText() { return `${this.method} ${this.path} HTTP/1.1\r\n${this._serializedHeaders()}\r\n` }
  _readResponse(socket) {
    let buffer = Buffer.alloc(0); let response
    socket.on('data', (chunk) => {
      if (response) { response.push(chunk); return }
      buffer = Buffer.concat([buffer, Buffer.from(chunk)])
      const end = buffer.toString().indexOf('\r\n\r\n')
      if (end < 0)
        return
      const [statusLine, ...headerLines] = buffer.slice(0, end).toString().split('\r\n')
      const [version, statusCode, ...statusMessage] = statusLine.split(' ')
      response = new IncomingMessage(socket)
      response.httpVersion = version?.replace('HTTP/', '') ?? '1.1'
      response.statusCode = Number(statusCode ?? 0)
      response.statusMessage = statusMessage.join(' ')
      Object.assign(response, parseHeaders(headerLines))
      this.emit('response', response)
      const body = buffer.slice(end + 4, buffer.length)
      if (body.length)
        response.push(body)
    })
    socket.once('end', () => { if (response) { response.complete = true; response.push(null) } })
  }

  abort() { this.destroy() }
  destroy(error?) { this.socket.destroy(error); return this }
  setNoDelay(noDelay = true) { this.socket.setNoDelay(noDelay) }
  setSocketKeepAlive(enable = false, initialDelay = 0) { this.socket.setKeepAlive(enable, initialDelay) }
  setTimeout(timeout, callback?) { this.socket.setTimeout(timeout, callback); return this }
}

export class Server extends NetServer {
  constructor(options?: any, requestListener?) {
    if (typeof options === 'function') { requestListener = options; options = {} }
    super(options)
    this.on('connection', socket => _connectionListener.call(this, socket))
    if (requestListener)
      this.on('request', requestListener)
  }
}
export const globalAgent = new Agent()
export const createServer = (options?, requestListener?) => new Server(options, requestListener)
export const request = (input, options?, callback?) => new ClientRequest(input, options, callback)
export const get = (input, options?, callback?) => { const request_ = request(input, options, callback); request_.end(); return request_ }
export const setMaxIdleHTTPParsers = () => unsupported('http.setMaxIdleHTTPParsers')
export const setGlobalProxyFromEnv = () => unsupported('http.setGlobalProxyFromEnv')
export const _connectionListener = function (socket) {
  let buffer = Buffer.alloc(0); let request; let expected = 0; let received = 0
  socket.on('data', (chunk) => {
    if (request) { request.push(chunk); received += chunk.length; if (received >= expected) { request.complete = true; request.push(null) }; return }
    buffer = Buffer.concat([buffer, Buffer.from(chunk)])
    const end = buffer.toString().indexOf('\r\n\r\n')
    if (end < 0)
      return
    const [requestLine, ...headerLines] = buffer.slice(0, end).toString().split('\r\n')
    const [method, url, version = 'HTTP/1.1'] = requestLine.split(' ')
    request = new IncomingMessage(socket)
    request.method = method; request.url = url; request.httpVersion = version.replace('HTTP/', '')
    Object.assign(request, parseHeaders(headerLines))
    expected = Number(request.headers['content-length'] ?? 0)
    const response = new ServerResponse(request)
    this.emit('request', request, response)
    const body = buffer.slice(end + 4, buffer.length)
    if (body.length) { request.push(body); received += body.length }
    if (received >= expected) { request.complete = true; request.push(null) }
  })
}

export default { _connectionListener, Agent, ClientRequest, CloseEvent, createServer, get, globalAgent, IncomingMessage, maxHeaderSize, MessageEvent, METHODS, OutgoingMessage, request, Server, ServerResponse, setGlobalProxyFromEnv, setMaxIdleHTTPParsers, STATUS_CODES, validateHeaderName, validateHeaderValue, WebSocket }
