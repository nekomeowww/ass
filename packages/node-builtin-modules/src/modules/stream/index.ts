import EventEmitter from '@ass/node-builtin-modules/events'

import { Buffer } from '@ass/node-builtin-modules/buffer'

let byteHighWaterMark = 64 * 1024
let objectHighWaterMark = 16

export class Stream extends EventEmitter {
  destroyed = false
  readable = false
  writable = false

  destroy(error?) {
    if (this.destroyed)
      return this
    this.destroyed = true
    if (error)
      this.emit('error', error)
    this.emit('close')
    return this
  }

  pipe(destination, options: any = {}) {
    this.on('data', chunk => destination.write(chunk))
    if (options.end !== false)
      this.once('end', () => destination.end())
    this.once('error', error => destination.destroy?.(error))
    return destination
  }
}

export class Readable extends Stream {
  _encoding?: string
  _ended = false
  _queue: any[] = []
  _waiting: Array<(value: IteratorResult<any>) => void> = []
  readable = true
  readableDidRead = false
  readableEnded = false

  constructor(options: any = {}) {
    super()
    if (options.read)
      this._read = options.read
  }

  static from(iterable) {
    const readable = new Readable({ objectMode: true })
    queueMicrotask(async () => {
      try {
        for await (const chunk of iterable)
          readable.push(chunk)
        readable.push(null)
      }
      catch (error) { readable.destroy(error) }
    })
    return readable
  }

  static fromWeb(stream) {
    return Readable.from({ async* [Symbol.asyncIterator]() {
      const reader = stream.getReader()
      try {
        while (true) {
          const result = await reader.read()
          if (result.done)
            return
          yield result.value
        }
      }
      finally { reader.releaseLock() }
    } })
  }

  static isDisturbed(stream) { return Boolean(stream?.readableDidRead || stream?.locked) }
  static toWeb(stream): any {
    const iterator = stream[Symbol.asyncIterator]()
    return new ReadableStream({
      cancel: reason => iterator.return?.(reason),
      pull: async (controller) => {
        const result = await iterator.next()
        if (result.done)
          controller.close()
        else
          controller.enqueue(result.value)
      },
    })
  }

  _read(_size?) {}
  push(chunk) {
    if (chunk === null) {
      this._ended = true
      this.readable = false
      this.readableEnded = true
      for (const resolve of this._waiting.splice(0))
        resolve({ done: true, value: undefined })
      this.emit('end')
      return false
    }
    this.readableDidRead = true
    const resolve = this._waiting.shift()
    if (resolve)
      resolve({ done: false, value: chunk })
    else if (this.listenerCount('data') === 0)
      this._queue.push(chunk)
    if (this.listenerCount('data') > 0)
      this.emit('data', chunk)
    return this._queue.length < objectHighWaterMark
  }

  read() {
    this._read()
    return this._queue.shift() ?? null
  }

  setEncoding(encoding) {
    const convert = chunk => typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString(encoding)
    this._queue = this._queue.map(convert)
    this._encoding = encoding
    return this
  }

  [Symbol.asyncIterator]() {
    const stream = this
    return {
      async next() {
        if (stream._queue.length)
          return { done: false, value: stream._queue.shift() }
        if (stream._ended)
          return { done: true, value: undefined }
        stream._read()
        return new Promise(resolve => stream._waiting.push(resolve))
      },
      async return() { stream.destroy(); return { done: true, value: undefined } },
      [Symbol.asyncIterator]() { return this },
    }
  }

  unpipe(destination?) {
    if (destination)
      this.removeAllListeners('data')
    return this
  }
}

export class Writable extends Stream {
  _finalImplementation?: (callback: (error?: Error) => void) => void
  _writeImplementation?: (chunk: any, encoding: string, callback: (error?: Error) => void) => void
  writable = true
  writableEnded = false
  writableFinished = false

  constructor(options: any = {}) {
    super()
    this._writeImplementation = options.write
    this._finalImplementation = options.final
  }

  static fromWeb(stream) {
    const writer = stream.getWriter()
    return new Writable({ final: callback => writer.close().then(() => callback(), callback), write: (chunk, _encoding, callback) => writer.write(chunk).then(() => callback(), callback) })
  }

  static toWeb(stream) {
    return new WritableStream({ abort: error => stream.destroy(error), close: () => new Promise((resolve, reject) => stream.end(error => error ? reject(error) : resolve(undefined))), write: chunk => new Promise((resolve, reject) => stream.write(chunk, error => error ? reject(error) : resolve(undefined))) })
  }

  _write(_chunk, _encoding, callback) { callback() }
  end(chunk?, encoding?, callback?) {
    if (typeof encoding === 'function') { callback = encoding; encoding = undefined }
    if (typeof chunk === 'function') { callback = chunk; chunk = undefined }
    if (chunk !== undefined)
      this.write(chunk, encoding)
    const finish = (error?) => {
      if (error)
        this.emit('error', error)
      this.writable = false
      this.writableEnded = true
      this.writableFinished = !error
      if (!error)
        this.emit('finish')
      callback?.(error)
    }
    if (this._finalImplementation)
      this._finalImplementation(finish)
    else
      finish()
    return this
  }

  write(chunk, encoding?, callback?) {
    if (typeof encoding === 'function') { callback = encoding; encoding = undefined }
    const done = (error) => {
      if (error)
        this.emit('error', error)
      callback?.(error)
    }
    const implementation = this._writeImplementation ?? this._write
    implementation.call(this, chunk, encoding ?? 'utf8', done)
    return true
  }
}

export class Duplex extends Readable {
  _finalImplementation?: Writable['_finalImplementation']
  _writeImplementation?: Writable['_writeImplementation']
  writable = true
  writableEnded = false
  writableFinished = false

  constructor(options: any = {}) {
    super(options)
    this._writeImplementation = options.write
    this._finalImplementation = options.final
  }

  static from(value) { return value instanceof Duplex ? value : Readable.from(value) }
  static fromWeb(pair) {
    const readable = Readable.fromWeb(pair.readable)
    const writable = Writable.fromWeb(pair.writable)
    const duplex = new Duplex({ final: writable.end.bind(writable), write: writable.write.bind(writable) })
    readable.on('data', chunk => duplex.push(chunk)).on('end', () => duplex.push(null))
    return duplex
  }

  static toWeb(stream) { return { readable: Readable.toWeb(stream), writable: Writable.toWeb(stream) } }
  end(...args) { return Writable.prototype.end.apply(this, args) }
  write(...args) { return Writable.prototype.write.apply(this, args) }
}

export class Transform extends Duplex {
  _transformImplementation?: (chunk: any, encoding: string, callback: (error?: Error, output?: any) => void) => void
  constructor(options: any = {}) {
    super(options)
    this._transformImplementation = options.transform
    this._writeImplementation = (chunk, encoding, callback) => {
      const transform = this._transformImplementation ?? this._transform
      transform.call(this, chunk, encoding, (error, output) => {
        if (output !== undefined)
          this.push(output)
        callback(error)
      })
    }
  }

  _transform(chunk, _encoding, callback) { callback(null, chunk) }
  end(chunk?, encoding?, callback?) {
    if (typeof encoding === 'function') { callback = encoding; encoding = undefined }
    if (typeof chunk === 'function') { callback = chunk; chunk = undefined }
    return super.end(chunk, encoding, (error) => {
      if (!error)
        this.push(null)
      callback?.(error)
    })
  }
}

export class PassThrough extends Transform {}

export const finished = (stream, options?, callback?) => {
  if (typeof options === 'function') { callback = options; options = {} }
  let settled = false
  const done = (error?: any) => {
    if (settled)
      return
    settled = true
    callback?.(error)
  }
  stream.once('error', done)
  if (stream.readable && options?.readable !== false)
    stream.once('end', () => done())
  if (stream.writable && options?.writable !== false)
    stream.once('finish', () => done())
  if (!stream.readable && !stream.writable)
    queueMicrotask(() => done())
  return () => { settled = true }
}

export const pipeline = (...args) => {
  const callback = typeof args.at(-1) === 'function' ? args.pop() : undefined
  const streams = Array.isArray(args[0]) ? args[0] : args
  for (let index = 0; index + 1 < streams.length; index++)
    streams[index].pipe(streams[index + 1])
  const last = streams.at(-1)
  if (callback)
    finished(last, callback)
  return last
}

export const promises = {
  finished: (stream, options?) => new Promise((resolve, reject) => finished(stream, options, error => error ? reject(error) : resolve(undefined))),
  pipeline: (...streams) => new Promise((resolve, reject) => pipeline(...streams, error => error ? reject(error) : resolve(undefined))),
}
export const addAbortSignal = (signal, stream) => {
  if (signal.aborted)
    stream.destroy(signal.reason); else signal.addEventListener('abort', () => stream.destroy(signal.reason), { once: true }); return stream
}
export const compose = (...streams) => pipeline(...streams)
export const destroy = (stream, error?) => stream.destroy(error)
export const duplexPair = () => { const first = new PassThrough(); const second = new PassThrough(); first.pipe(second, { end: false }); second.pipe(first, { end: false }); return [first, second] }
export const getDefaultHighWaterMark = objectMode => objectMode ? objectHighWaterMark : byteHighWaterMark
export const isDestroyed = stream => Boolean(stream?.destroyed)
export const isDisturbed = Readable.isDisturbed
export const isErrored = stream => Boolean(stream?.errored || stream?.readableErrored || stream?.writableErrored)
export const isReadable = stream => Boolean(stream?.readable && !stream?.destroyed)
export const isWritable = stream => Boolean(stream?.writable && !stream?.destroyed)
export const setDefaultHighWaterMark = (objectMode, value) => {
  if (objectMode)
    objectHighWaterMark = value; else byteHighWaterMark = value
}
export const _isArrayBufferView = ArrayBuffer.isView
export const _isUint8Array = value => value instanceof Uint8Array
export const _uint8ArrayToBuffer = value => Buffer.from(value.buffer, value.byteOffset, value.byteLength)

export default Object.assign(Stream, { _isArrayBufferView, _isUint8Array, _uint8ArrayToBuffer, addAbortSignal, compose, destroy, Duplex, duplexPair, finished, getDefaultHighWaterMark, isDestroyed, isDisturbed, isErrored, isReadable, isWritable, PassThrough, pipeline, promises, Readable, setDefaultHighWaterMark, Stream, Transform, Writable })
