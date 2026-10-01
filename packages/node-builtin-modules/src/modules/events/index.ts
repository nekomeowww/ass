export class EventEmitter {
  declare static defaultMaxListeners: number
  declare _events: Map<any, any[]>
  declare _maxListeners?: number

  constructor() {
    this._events = new Map()
  }

  static on(emitter, name) {
    const queue = []; const waiting = []
    const listener = (...args) => {
      const resolve = waiting.shift()
      if (resolve)
        resolve({ done: false, value: args })
      else queue.push(args)
    }
    emitter.on(name, listener)
    return {
      next() { return queue.length ? Promise.resolve({ done: false, value: queue.shift() }) : new Promise(resolve => waiting.push(resolve)) },
      return() { emitter.off(name, listener); return Promise.resolve({ done: true }) },
      [Symbol.asyncIterator]() { return this },
    }
  }

  static once(emitter, name, options) {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        emitter.off(name, onEvent)
        emitter.off('error', onError)
        options?.signal?.removeEventListener('abort', onAbort)
      }
      const onEvent = (...args) => { cleanup(); resolve(args) }
      const onError = (error) => { cleanup(); reject(error) }
      const onAbort = () => { cleanup(); reject(options.signal.reason ?? new DOMException('The operation was aborted', 'AbortError')) }
      emitter.once(name, onEvent)
      if (name !== 'error')
        emitter.once('error', onError)
      options?.signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  addListener(name, listener) { return this.on(name, listener) }
  emit(name, ...args) {
    const listeners = this._events.get(name)?.slice() ?? []
    if (!listeners.length && name === 'error')
      throw args[0] instanceof Error ? args[0] : new Error(String(args[0]))
    for (const listener of listeners) listener.apply(this, args)
    return listeners.length > 0
  }

  eventNames() { return Array.from(this._events.keys()) }
  getMaxListeners() { return this._maxListeners ?? EventEmitter.defaultMaxListeners }
  listenerCount(name, listener?) { return this.listeners(name).filter(value => !listener || value === listener).length }
  listeners(name) { return (this._events.get(name) ?? []).map(listener => listener.listener ?? listener) }
  off(name, listener) { return this.removeListener(name, listener) }
  on(name, listener) { this._events.set(name, [...(this._events.get(name) ?? []), listener]); return this }
  once(name, listener) {
    const wrapped = (...args) => { this.off(name, wrapped); listener.apply(this, args) }
    wrapped.listener = listener
    return this.on(name, wrapped)
  }

  prependListener(name, listener) { this._events.set(name, [listener, ...(this._events.get(name) ?? [])]); return this }
  prependOnceListener(name, listener) {
    const wrapped = (...args) => { this.off(name, wrapped); listener.apply(this, args) }
    wrapped.listener = listener
    return this.prependListener(name, wrapped)
  }

  rawListeners(name) { return (this._events.get(name) ?? []).slice() }
  removeAllListeners(name) { name === undefined ? this._events.clear() : this._events.delete(name); return this }
  removeListener(name, listener) {
    const listeners = this._events.get(name) ?? []
    const index = listeners.findIndex(value => value === listener || value.listener === listener)
    if (index >= 0)
      listeners.splice(index, 1)
    if (listeners.length)
      this._events.set(name, listeners); else this._events.delete(name)
    return this
  }

  setMaxListeners(value) { this._maxListeners = value; return this }
}
EventEmitter.defaultMaxListeners = 10
export const once = EventEmitter.once
export const on = EventEmitter.on
export const getEventListeners = (emitter, name) => emitter.listeners ? emitter.listeners(name) : []
export const getMaxListeners = emitter => emitter.getMaxListeners?.() ?? EventEmitter.defaultMaxListeners
export const setMaxListeners = (value, ...emitters) => { for (const emitter of emitters) emitter.setMaxListeners(value) }
export const addAbortListener = (signal, listener) => { signal.addEventListener('abort', listener, { once: true }); return { [Symbol.dispose]: () => signal.removeEventListener('abort', listener) } }
export default EventEmitter
