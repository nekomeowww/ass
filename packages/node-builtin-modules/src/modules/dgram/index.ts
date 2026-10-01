import EventEmitter from '@ass/node-builtin-modules/events'

import { Buffer } from '@ass/node-builtin-modules/buffer'
import { bytesToBase64, op, setResourceReferenced } from '@ass/node-builtin-modules/internal/ops'

const unsupported = (name) => {
  const error = new Error(`${name} is not implemented by the ass UDP adapter`)
  throw Object.assign(error, { code: 'ERR_ASS_UNSUPPORTED' })
}

export class Socket extends EventEmitter {
  _address: any
  _bindPromise?: Promise<any>
  _connected = false
  _receiving = false
  _referenced = true
  _remote: any
  _resource?: number
  type: string

  constructor(typeOrOptions, listener?) {
    super()
    const options = typeof typeOrOptions === 'string' ? { type: typeOrOptions } : typeOrOptions
    this.type = options.type
    if (listener)
      this.on('message', listener)
  }

  _ensureBound() {
    if (!this._bindPromise)
      this.bind(0)
    return this._bindPromise
  }

  _startReceiving() {
    if (this._receiving || !this._resource)
      return
    this._receiving = true
    const receive = async () => {
      while (this._resource) {
        try {
          const result: any = await op('dgram.receive', { resource: this._resource })
          if (result.pending) {
            await new Promise(resolve => setTimeout(resolve, 5))
            continue
          }
          this.emit('message', Buffer.from(result.base64, 'base64'), { ...result.remote, size: result.size })
        }
        catch (error) {
          if (this._resource)
            this.emit('error', error)
          return
        }
      }
    }
    void receive()
  }

  addMembership() { return unsupported('dgram.addMembership') }
  address() {
    if (!this._address)
      throw Object.assign(new Error('Not running'), { code: 'EBADF' })
    return { ...this._address }
  }

  addSourceSpecificMembership() { return unsupported('dgram.addSourceSpecificMembership') }
  bind(...args) {
    const callback = typeof args.at(-1) === 'function' ? args.pop() : undefined
    if (callback)
      this.once('listening', callback)
    const options = typeof args[0] === 'object' ? args[0] : { address: args[1], port: args[0] }
    const address = options.address ?? (this.type === 'udp6' ? '::' : '0.0.0.0')
    this._bindPromise = op('dgram.bind', { address, port: Number(options.port ?? 0) }).then((info: any) => {
      this._resource = info.resource
      this._address = info.address
      if (!this._referenced)
        setResourceReferenced(this._resource, false)
      this.emit('listening')
      this._startReceiving()
      return info
    }, error => this.emit('error', error))
    return this
  }

  close(callback?) {
    if (callback)
      this.once('close', callback)
    const resource = this._resource
    this._resource = undefined
    if (!resource) {
      queueMicrotask(() => this.emit('close'))
      return this
    }
    op('dgram.close', { resource }).then(() => this.emit('close'), error => this.emit('error', error))
    return this
  }

  connect(port, address?, callback?) {
    if (typeof address === 'function') { callback = address; address = undefined }
    if (callback)
      this.once('connect', callback)
    this._ensureBound().then(() => op('dgram.connect', { address: address ?? (this.type === 'udp6' ? '::1' : '127.0.0.1'), port: Number(port), resource: this._resource })).then((info: any) => {
      this._connected = true
      this._remote = info.remote
      this.emit('connect')
    }, error => this.emit('error', error))
    return this
  }

  disconnect() { return unsupported('dgram.disconnect') }
  dropMembership() { return unsupported('dgram.dropMembership') }
  dropSourceSpecificMembership() { return unsupported('dgram.dropSourceSpecificMembership') }
  getRecvBufferSize() { return unsupported('dgram.getRecvBufferSize') }
  getSendBufferSize() { return unsupported('dgram.getSendBufferSize') }
  ref() { this._referenced = true; setResourceReferenced(this._resource, true); return this }
  remoteAddress() {
    if (!this._connected)
      throw Object.assign(new Error('Not connected'), { code: 'ERR_SOCKET_DGRAM_NOT_CONNECTED' })
    return { ...this._remote }
  }

  send(message, ...args) {
    const callback = typeof args.at(-1) === 'function' ? args.pop() : undefined
    const data = Buffer.isBuffer(message) ? message : Array.isArray(message) ? Buffer.concat(message.map(value => Buffer.from(value))) : Buffer.from(message)
    const port = this._connected ? undefined : Number(args[0])
    const address = this._connected ? undefined : args[1] ?? (this.type === 'udp6' ? '::1' : '127.0.0.1')
    this._ensureBound().then(() => op('dgram.send', { address, data: bytesToBase64(data), port, resource: this._resource })).then((result: any) => callback?.(null, result.bytesWritten), error => callback ? callback(error) : this.emit('error', error))
    return undefined
  }

  setBroadcast(value) { void this._ensureBound().then(() => op('dgram.setBroadcast', { resource: this._resource, value: Boolean(value) })); return this }
  setMulticastInterface() { return unsupported('dgram.setMulticastInterface') }
  setMulticastLoopback() { return unsupported('dgram.setMulticastLoopback') }
  setMulticastTTL() { return unsupported('dgram.setMulticastTTL') }
  setRecvBufferSize() { return unsupported('dgram.setRecvBufferSize') }
  setSendBufferSize() { return unsupported('dgram.setSendBufferSize') }
  setTTL(value) { void this._ensureBound().then(() => op('dgram.setTtl', { resource: this._resource, value: Number(value) })); return this }
  unref() { this._referenced = false; setResourceReferenced(this._resource, false); return this }
}

export const createSocket = (typeOrOptions, listener?) => new Socket(typeOrOptions, listener)
export default { createSocket, Socket }
