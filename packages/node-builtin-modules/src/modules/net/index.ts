import EventEmitter from '@ass/node-builtin-modules/events'

import { Buffer } from '@ass/node-builtin-modules/buffer'
import { bytesToBase64, op, setResourceReferenced } from '@ass/node-builtin-modules/internal/ops'
import { Duplex } from '@ass/node-builtin-modules/stream'

let defaultAutoSelectFamily = true
let defaultAutoSelectFamilyAttemptTimeout = 250
const unsupported = (name) => {
  const error = new Error(`${name} is not implemented by the ass TCP adapter`)
  throw Object.assign(error, { code: 'ERR_ASS_UNSUPPORTED' })
}

export const isIPv4 = (value) => {
  const parts = String(value).split('.')
  return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255 && String(Number(part)) === part)
}
export const isIPv6 = (value) => {
  try { return String(value).includes(':') && new URL(`http://[${value}]/`).hostname.length > 0 }
  catch { return false }
}
export const isIP = value => isIPv4(value) ? 4 : isIPv6(value) ? 6 : 0

export class BlockList {
  _rules: Array<{ address?: string, end?: string, family?: string, prefix?: number, start?: string }> = []
  get rules() { return this._rules.map(rule => JSON.stringify(rule)) }
  addAddress(address, family = 'ipv4') { this._rules.push({ address, family }); return this }
  addRange(start, end, family = 'ipv4') { this._rules.push({ end, family, start }); return this }
  addSubnet(network, prefix, family = 'ipv4') { this._rules.push({ address: network, family, prefix }); return this }
  check(address, family = 'ipv4') {
    return this._rules.some((rule) => {
      if (rule.family !== family)
        return false
      if (rule.address === address)
        return true
      if (family === 'ipv4' && rule.start && rule.end) {
        const number = value => value.split('.').reduce((result, part) => result * 256 + Number(part), 0)
        return number(address) >= number(rule.start) && number(address) <= number(rule.end)
      }
      if (family === 'ipv4' && rule.prefix !== undefined) {
        const number = value => value.split('.').reduce((result, part) => result * 256 + Number(part), 0) >>> 0
        const mask = rule.prefix === 0 ? 0 : (0xFFFFFFFF << (32 - rule.prefix)) >>> 0
        return (number(address) & mask) === (number(rule.address) & mask)
      }
      return false
    })
  }
}

export class SocketAddress {
  address: string
  family: string
  flowlabel: number
  port: number
  constructor(options: any = {}) {
    this.address = options.address ?? (options.family === 'ipv6' ? '::' : '0.0.0.0')
    this.family = options.family === 6 || String(options.family).toLowerCase() === 'ipv6' || isIPv6(this.address) ? 'ipv6' : 'ipv4'
    this.flowlabel = options.flowlabel ?? 0
    this.port = options.port ?? 0
  }

  static parse(value) {
    const match = String(value).match(/^\[([^\]]+)\]:(\d+)$/) ?? String(value).match(/^([^:]+):(\d+)$/)
    return match ? new SocketAddress({ address: match[1], port: Number(match[2]) }) : undefined
  }
}

const normalizeConnectArgs = (args) => {
  const callback = typeof args.at(-1) === 'function' ? args.pop() : undefined
  const options = typeof args[0] === 'object' ? { ...args[0] } : { host: typeof args[1] === 'string' ? args[1] : undefined, port: args[0] }
  return [{ host: options.host ?? 'localhost', noDelay: options.noDelay ?? false, port: Number(options.port) }, callback]
}

export class Socket extends Duplex {
  _connectPromise?: Promise<any>
  _local: any
  _noDelay?: boolean
  _opPrefix = 'net'
  _pendingWrite = Promise.resolve()
  _reading = false
  _referenced = true
  _remote: any
  _resource?: number
  _timeout?: ReturnType<typeof setTimeout>
  connecting = false
  pending = true
  readyState = 'closed'

  get localAddress() { return this._local?.address }
  get localFamily() { return this._local?.family }
  get localPort() { return this._local?.port }
  get remoteAddress() { return this._remote?.address }
  get remoteFamily() { return this._remote?.family }
  get remotePort() { return this._remote?.port }
  constructor(options: any = {}) {
    super(options)
    this._writeImplementation = (chunk, encoding, callback) => {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk, encoding) : Buffer.from(chunk)
      this._pendingWrite = this._pendingWrite.then(() => this._connected()).then(async () => {
        let offset = 0
        while (offset < bytes.length) {
          const end = Math.min(offset + 64 * 1024, bytes.length)
          const result: any = await this._native('write', { data: bytesToBase64(bytes.subarray(offset, end)), resource: this._resource })
          offset += result.bytesWritten ?? 0
          if (result.pending || result.bytesWritten === 0)
            await new Promise(resolve => setTimeout(resolve, 5))
        }
      })
      this._pendingWrite.then(() => callback(), callback)
    }
    this._finalImplementation = (callback) => {
      this._pendingWrite.then(() => this._connected()).then(() => this._resource ? this._native('shutdownWrite', { resource: this._resource }) : undefined).then(() => callback(), callback)
    }
  }

  _configure(info) {
    this._resource = info.resource
    this._local = info.local
    this._remote = info.remote
    this.connecting = false
    this.pending = false
    this.readyState = 'open'
    if (!this._referenced)
      setResourceReferenced(this._resource, false)
    if (this._noDelay !== undefined)
      void this._native('setNoDelay', { resource: this._resource, value: this._noDelay }).catch(error => this.emit('error', error))
  }

  _connected() { return this._connectPromise ?? Promise.resolve() }
  _native(operation, args) { return op(`${this._opPrefix}.${operation}`, args) }
  _startReadLoop() {
    if (this._reading || !this._resource)
      return
    this._reading = true
    const read = async () => {
      while (!this.destroyed && this._resource) {
        try {
          const result: any = await this._native('read', { resource: this._resource })
          if (result.pending) {
            await new Promise(resolve => setTimeout(resolve, 5))
            continue
          }
          if (result.eof) {
            this.push(null)
            this.destroy()
            return
          }
          this.push(Buffer.from(result.base64, 'base64'))
        }
        catch (error) {
          if (!this.destroyed)
            this.destroy(error)
          return
        }
      }
    }
    void read()
  }

  address() { return this._local ? { ...this._local } : {} }
  connect(...args) {
    const [options, callback] = normalizeConnectArgs(args)
    options.noDelay = this._noDelay ?? options.noDelay
    if (callback)
      this.once('connect', callback)
    this.connecting = true
    this.pending = true
    this.readyState = 'opening'
    this._connectPromise = this._native('connect', options).then((info) => {
      this._configure(info)
      this.emit('connect')
      this.emit('ready')
      this._startReadLoop()
    }, error => this.destroy(error))
    return this
  }

  destroy(error?) {
    const resource = this._resource
    this._resource = undefined
    this.readyState = 'closed'
    if (resource)
      void this._native('close', { resource }).catch(() => {})
    return super.destroy(error)
  }

  ref() { this._referenced = true; setResourceReferenced(this._resource, true); return this }
  resetAndDestroy() { return this.destroy() }
  setKeepAlive(_enable = false, _initialDelay = 0) { return unsupported('net.Socket.setKeepAlive') }
  setNoDelay(noDelay = true) {
    this._noDelay = Boolean(noDelay)
    if (this._resource)
      void this._native('setNoDelay', { resource: this._resource, value: this._noDelay }).catch(error => this.emit('error', error))
    return this
  }

  setTimeout(timeout, callback?) {
    if (callback)
      this.once('timeout', callback); clearTimeout(this._timeout); if (timeout > 0)
      this._timeout = setTimeout(() => this.emit('timeout'), timeout); return this
  }

  unref() { this._referenced = false; setResourceReferenced(this._resource, false); return this }
}

export class Server extends EventEmitter {
  _address: any
  _connections = new Set<Socket>()
  _referenced = true
  _resource?: number
  listening = false
  maxConnections?: number

  constructor(options?: any, connectionListener?) {
    super()
    if (typeof options === 'function')
      connectionListener = options
    if (connectionListener)
      this.on('connection', connectionListener)
  }

  _acceptLoop() {
    /**
     * Polls the native listener and dispatches accepted sockets.
     *
     * Triggering workflow:
     *
     * {@link Server.listen}
     *   -> {@link Server._acceptLoop}
     *     -> `net.accept`
     *       -> {@link accept}
     *
     * Upstream:
     * - {@link Server.listen}
     *
     * Downstream:
     * - `connection` event listeners and {@link Socket._startReadLoop}
     */
    const accept = async () => {
      while (this.listening && this._resource) {
        let info: any
        try {
          info = await op('net.accept', { resource: this._resource })
        }
        catch (error) {
          if (this.listening)
            this.emit('error', error)
          return
        }
        if (!this.listening)
          return
        if (info.pending) {
          await new Promise(resolve => setTimeout(resolve, 10))
          continue
        }
        const socket = new Socket()
        socket._configure(info)
        this._connections.add(socket)
        socket.once('close', () => this._connections.delete(socket))
        this.emit('connection', socket)
        socket._startReadLoop()
      }
    }
    void accept()
  }

  address() { return this._address ? { ...this._address } : null }
  close(callback?) {
    if (callback)
      this.once('close', callback)
    this.listening = false
    const resource = this._resource
    this._resource = undefined
    if (!resource) {
      queueMicrotask(() => this.emit('close'))
      return this
    }
    op('net.close', { resource }).then(() => this.emit('close'), error => this.emit('error', error))
    return this
  }

  closeAllConnections() { for (const socket of this._connections) socket.destroy() }
  closeIdleConnections() { return unsupported('net.Server.closeIdleConnections') }
  getConnections(callback) { queueMicrotask(() => callback(null, this._connections.size)) }
  listen(...args) {
    const callback = typeof args.at(-1) === 'function' ? args.pop() : undefined
    if (callback)
      this.once('listening', callback)
    const options = typeof args[0] === 'object' ? args[0] : { host: typeof args[1] === 'string' ? args[1] : undefined, port: args[0] }
    op('net.listen', { host: options.host ?? '0.0.0.0', port: Number(options.port ?? 0) }).then((info: any) => {
      this._resource = info.resource
      this._address = info.address
      if (!this._referenced)
        setResourceReferenced(this._resource, false)
      this.listening = true
      this.emit('listening')
      this._acceptLoop()
    }, error => this.emit('error', error))
    return this
  }

  ref() { this._referenced = true; setResourceReferenced(this._resource, true); return this }
  unref() { this._referenced = false; setResourceReferenced(this._resource, false); return this }
}

export const createConnection = (...args) => new Socket().connect(...args)
export const connect = createConnection
export const createServer = (options?, connectionListener?) => new Server(options, connectionListener)
export const getDefaultAutoSelectFamily = () => defaultAutoSelectFamily
export const setDefaultAutoSelectFamily = (value) => { defaultAutoSelectFamily = Boolean(value) }
export const getDefaultAutoSelectFamilyAttemptTimeout = () => defaultAutoSelectFamilyAttemptTimeout
export const setDefaultAutoSelectFamilyAttemptTimeout = (value) => { defaultAutoSelectFamilyAttemptTimeout = Number(value) }
export const Stream = Socket
export const _normalizeArgs = args => normalizeConnectArgs([...args])

export default { _normalizeArgs, BlockList, connect, createConnection, createServer, getDefaultAutoSelectFamily, getDefaultAutoSelectFamilyAttemptTimeout, isIP, isIPv4, isIPv6, Server, setDefaultAutoSelectFamily, setDefaultAutoSelectFamilyAttemptTimeout, Socket, SocketAddress, Stream }
