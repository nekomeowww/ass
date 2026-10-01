import EventEmitter from '@ass/node-builtin-modules/events'

import { Buffer } from '@ass/node-builtin-modules/buffer'
import { op, setResourceReferenced } from '@ass/node-builtin-modules/internal/ops'
import { Socket } from '@ass/node-builtin-modules/net'

const unsupported = (name) => {
  const error = new Error(`${name} is not implemented by the ass TLS adapter`)
  throw Object.assign(error, { code: 'ERR_ASS_UNSUPPORTED' })
}

const encodeMaterial = (value) => {
  if (value === undefined)
    return undefined
  const values = Array.isArray(value) ? value : [value]
  return Buffer.concat(values.map(item => Buffer.from(item))).toString('base64')
}

const alpnProtocols = value => value?.map(protocol => Buffer.from(protocol).toString())

export const CLIENT_RENEG_LIMIT = 3
export const CLIENT_RENEG_WINDOW = 600
export const DEFAULT_CIPHERS = 'TLS_AES_256_GCM_SHA384:TLS_AES_128_GCM_SHA256:TLS_CHACHA20_POLY1305_SHA256'
export const DEFAULT_ECDH_CURVE = 'auto'
export const DEFAULT_MAX_VERSION = 'TLSv1.3'
export const DEFAULT_MIN_VERSION = 'TLSv1.2'

export class SecureContext {
  context: any
  constructor(options: any = {}) { this.context = { ...options } }
}

export const createSecureContext = options => new SecureContext(options)

const normalizeConnectArgs = (args) => {
  const callback = typeof args.at(-1) === 'function' ? args.pop() : undefined
  let options
  if (typeof args[0] === 'object')
    options = { ...args[0] }
  else
    options = { ...((typeof args[1] === 'object' && args[1]) || {}), host: typeof args[1] === 'string' ? args[1] : undefined, port: args[0] }
  return [{ ...options, host: options.host ?? 'localhost', port: Number(options.port) }, callback]
}

export class TLSSocket extends Socket {
  _peerCertificate?: string
  _protocol?: string
  alpnProtocol: false | string = false
  authorizationError?: Error
  authorized = false
  encrypted = true

  constructor(socketOrOptions?: any, options: any = {}) {
    super(socketOrOptions instanceof Socket ? options : socketOrOptions)
    this._opPrefix = 'tls'
    if (socketOrOptions instanceof Socket)
      unsupported('new tls.TLSSocket(existingSocket)')
  }

  _setTlsMetadata(info) {
    this.alpnProtocol = info?.tls?.alpnProtocol ?? false
    this._peerCertificate = info?.tls?.peerCertificate
    this._protocol = info?.tls?.protocol?.replace('TLSv1_', 'TLSv1.')
  }

  connect(...args) {
    const [options, callback] = normalizeConnectArgs(args)
    if (callback)
      this.once('secureConnect', callback)
    this.connecting = true
    this.pending = true
    this.readyState = 'opening'
    const secureContext = options.secureContext?.context ?? {}
    const nativeOptions = {
      alpnProtocols: alpnProtocols(options.ALPNProtocols ?? secureContext.ALPNProtocols),
      ca: encodeMaterial(options.ca ?? secureContext.ca),
      cert: encodeMaterial(options.cert ?? secureContext.cert),
      host: options.host,
      key: encodeMaterial(options.key ?? secureContext.key),
      port: options.port,
      servername: options.servername ?? options.host,
    }
    this._connectPromise = this._native('connect', nativeOptions).then((info) => {
      this._configure(info)
      this._setTlsMetadata(info)
      this.authorized = true
      this.emit('connect')
      this.emit('secureConnect')
      this.emit('ready')
      this._startReadLoop()
    }, (error) => {
      this.authorizationError = error
      this.destroy(error)
    })
    return this
  }

  disableRenegotiation() { return this }
  enableTrace() { return unsupported('tls.TLSSocket.enableTrace') }
  exportKeyingMaterial() { return unsupported('tls.TLSSocket.exportKeyingMaterial') }
  getCertificate() { return {} }
  getCipher() { return { name: this.getProtocol(), standardName: this.getProtocol(), version: this.getProtocol() } }
  getEphemeralKeyInfo() { return {} }
  getFinished() { return undefined }
  getPeerCertificate() { return this._peerCertificate ? { raw: Buffer.from(this._peerCertificate, 'base64') } : {} }
  getPeerFinished() { return undefined }
  getProtocol() { return this._protocol ?? null }
  getSession() { return undefined }
  isSessionReused() { return false }
  renegotiate() { return unsupported('tls.TLSSocket.renegotiate') }
  setKeyCert() { return unsupported('tls.TLSSocket.setKeyCert') }
  setMaxSendFragment() { return unsupported('tls.TLSSocket.setMaxSendFragment') }
  setServername() { return unsupported('tls.TLSSocket.setServername') }
}

export class Server extends EventEmitter {
  _address: any
  _connections = new Set<TLSSocket>()
  _handshakes = new Set<number>()
  _options: any
  _referenced = true
  _resource?: number
  listening = false

  constructor(options: any = {}, secureConnectionListener?) {
    super()
    if (typeof options === 'function') { secureConnectionListener = options; options = {} }
    this._options = { ...options }
    if (secureConnectionListener)
      this.on('secureConnection', secureConnectionListener)
  }

  _acceptLoop() {
    /**
     * Upgrades one accepted TCP resource without pausing the listener loop.
     *
     * Triggering workflow:
     *
     * {@link Server._acceptLoop}
     *   -> `tls.accept`
     *     -> `tls.handshake`
     *       -> {@link finishHandshake}
     *
     * Upstream:
     * - {@link Server.listen}
     *
     * Downstream:
     * - `secureConnection` or `tlsClientError`
     */
    const finishHandshake = async (resource: number): Promise<void> => {
      this._handshakes.add(resource)
      let info: any
      try {
        info = await op('tls.handshake', { resource })
      }
      catch (error) {
        await op('tls.close', { resource }).catch(() => {})
        if (this.listening)
          this.emit('tlsClientError', error)
      }
      finally {
        this._handshakes.delete(resource)
      }
      if (!info)
        return
      if (!this.listening) {
        await op('tls.close', { resource }).catch(() => {})
        return
      }
      const socket = new TLSSocket()
      socket._configure(info)
      socket._setTlsMetadata(info)
      socket.authorized = false
      this._connections.add(socket)
      socket.once('close', () => this._connections.delete(socket))
      this.emit('secureConnection', socket)
      socket._startReadLoop()
    }
    /**
     * Keeps accepting raw TCP resources while handshakes run independently.
     *
     * Triggering workflow:
     *
     * {@link Server.listen}
     *   -> {@link Server._acceptLoop}
     *     -> `tls.accept`
     *       -> {@link accept}
     *
     * Upstream:
     * - {@link Server.listen}
     *
     * Downstream:
     * - {@link finishHandshake}
     */
    const accept = async () => {
      while (this.listening && this._resource) {
        try {
          const info: any = await op('tls.accept', { resource: this._resource })
          if (!this.listening)
            return
          if (info.pending) {
            await new Promise(resolve => setTimeout(resolve, 10))
            continue
          }
          void finishHandshake(info.resource)
        }
        catch (error) {
          if (this.listening)
            this.emit('tlsClientError', error)
          if (this.listening)
            await new Promise(resolve => setTimeout(resolve, 10))
        }
      }
    }
    void accept()
  }

  address() { return this._address ? { ...this._address } : null }
  close(callback?) {
    if (callback)
      this.once('close', callback)
    this.listening = false
    for (const resource of this._handshakes)
      void op('tls.close', { resource }).catch(() => {})
    this._handshakes.clear()
    const resource = this._resource
    this._resource = undefined
    if (!resource) { queueMicrotask(() => this.emit('close')); return this }
    op('tls.close', { resource }).then(() => this.emit('close'), error => this.emit('error', error))
    return this
  }

  closeAllConnections() { for (const socket of this._connections) socket.destroy() }
  getConnections(callback) { queueMicrotask(() => callback(null, this._connections.size)) }
  listen(...args) {
    const callback = typeof args.at(-1) === 'function' ? args.pop() : undefined
    if (callback)
      this.once('listening', callback)
    const options = typeof args[0] === 'object' ? { ...this._options, ...args[0] } : { ...this._options, host: typeof args[1] === 'string' ? args[1] : undefined, port: args[0] }
    op('tls.listen', {
      alpnProtocols: alpnProtocols(options.ALPNProtocols),
      cert: encodeMaterial(options.cert),
      host: options.host ?? '0.0.0.0',
      key: encodeMaterial(options.key),
      port: Number(options.port ?? 0),
    }).then((info: any) => {
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
  setSecureContext(options) { this._options = { ...this._options, ...options } }
  unref() { this._referenced = false; setResourceReferenced(this._resource, false); return this }
}

export const checkServerIdentity = (hostname, certificate: any = {}) => {
  const commonName = certificate.subject?.CN ?? certificate.subject?.commonName
  if (!commonName || commonName === hostname)
    return undefined
  return Object.assign(new Error(`Hostname/IP does not match certificate's altnames: Host: ${hostname}`), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' })
}
export const connect = (...args) => new TLSSocket().connect(...args)
export const createServer = (options?, secureConnectionListener?) => new Server(options, secureConnectionListener)
export const convertALPNProtocols = (protocols, output) => { output.ALPNProtocols = protocols.map(protocol => Buffer.from(protocol)); return output }
export const getCACertificates = () => []
export const getCiphers = () => DEFAULT_CIPHERS.toLowerCase().split(':')
export const rootCertificates: string[] = []
export const setDefaultCACertificates = () => unsupported('tls.setDefaultCACertificates')

export default { checkServerIdentity, CLIENT_RENEG_LIMIT, CLIENT_RENEG_WINDOW, connect, convertALPNProtocols, createSecureContext, createServer, DEFAULT_CIPHERS, DEFAULT_ECDH_CURVE, DEFAULT_MAX_VERSION, DEFAULT_MIN_VERSION, getCACertificates, getCiphers, rootCertificates, SecureContext, Server, setDefaultCACertificates, TLSSocket }
