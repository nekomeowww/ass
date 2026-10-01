import EventEmitter from '@ass/node-builtin-modules/events'

const environmentData = new Map<any, any>()
const uncloneable = new WeakSet<object>()
const untransferable = new WeakSet<object>()
const unsupported = (name) => {
  const error = new Error(`${name} is unavailable: Web Workers cannot load Node.js worker entry points in ass`)
  throw Object.assign(error, { code: 'ERR_ASS_UNSUPPORTED' })
}

export const BroadcastChannel = globalThis.BroadcastChannel
export const MessageChannel = globalThis.MessageChannel
export const MessagePort = globalThis.MessagePort
export const SHARE_ENV = Symbol.for('nodejs.worker_threads.SHARE_ENV')
export const isInternalThread = false
export const isMainThread = true
export const parentPort = null
export const resourceLimits = {}
export const threadId = 0
export const threadName = ''
export const workerData = null
export const locks = globalThis.navigator?.locks

export class Worker extends EventEmitter {
  constructor(_filename, _options?) { super(); unsupported('worker_threads.Worker') }
}

export const getEnvironmentData = key => environmentData.get(key)
export const setEnvironmentData = (key, value) => environmentData.set(key, value)
export const markAsUncloneable = (value) => { uncloneable.add(value) }
export const markAsUntransferable = (value) => { untransferable.add(value) }
export const isMarkedAsUntransferable = value => untransferable.has(value)
export const moveMessagePortToContext = port => port
export const receiveMessageOnPort = () => undefined
export const postMessageToThread = () => Promise.reject(Object.assign(new Error('No target worker thread exists'), { code: 'ERR_WORKER_MESSAGING_FAILED' }))

export default { BroadcastChannel, getEnvironmentData, isInternalThread, isMainThread, isMarkedAsUntransferable, locks, markAsUncloneable, markAsUntransferable, MessageChannel, MessagePort, moveMessagePortToContext, parentPort, postMessageToThread, receiveMessageOnPort, resourceLimits, setEnvironmentData, SHARE_ENV, threadId, threadName, Worker, workerData }
