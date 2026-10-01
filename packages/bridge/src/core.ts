import type { NativeBridgeMessage } from './types'

import { inspect } from './inspect'
import { createProcess } from './process'
import { consoleLevels } from './types'

const send = (message: NativeBridgeMessage): void => {
  window.ipc.postMessage(JSON.stringify(message))
}

interface NativePending {
  realm: number
  reject: (reason: Error) => void
  resolve: (value: unknown) => void
}

let nextNativeId = 1
const nativePending = new Map<number, NativePending>()
const nativeIdleWaiters = new Map<number, Array<() => void>>()
const closedNativeRealms = new Set<number>()

const nativeCall = (method: string, args: unknown = null, realm = 0): Promise<unknown> =>
  new Promise((resolve, reject) => {
    if (closedNativeRealms.has(realm)) {
      reject(Object.assign(new Error(`native realm ${realm} is closed`), { code: 'ERR_ASS_REALM_CLOSED' }))
      return
    }
    const call = nextNativeId++
    nativePending.set(call, { realm, reject, resolve })
    send({ args, call, kind: 'native', op: method, realm, v: 1 })
  })

/**
 * Rejects every pending native operation owned by a closing JavaScript realm.
 *
 * Triggering workflow:
 *
 * `process.exit()` or isolated-frame cleanup
 *   -> {@link closeNativeRealm}
 *     -> `ERR_ASS_REALM_CLOSED`
 *       -> pending native Promise rejection
 *
 * Upstream:
 * - `createProcess` exit callback and `evaluateIsolated` cleanup
 *
 * Downstream:
 * - `nativePending` and `nativeIdleWaiters`
 */
const closeNativeRealm = (realm: number): void => {
  closedNativeRealms.add(realm)
  for (const [call, pending] of nativePending) {
    if (pending.realm !== realm)
      continue
    nativePending.delete(call)
    pending.reject(Object.assign(new Error(`native realm ${realm} was closed`), { code: 'ERR_ASS_REALM_CLOSED' }))
  }
  const waiters = nativeIdleWaiters.get(realm) ?? []
  nativeIdleWaiters.delete(realm)
  for (const resolve of waiters)
    resolve()
}

const hasPendingNative = (realm: number): boolean =>
  [...nativePending.values()].some(pending => pending.realm === realm)

const waitForNativeIdle = async (realm = 0, waitForReferencedResources = true): Promise<void> => {
  while (!closedNativeRealms.has(realm)) {
    while (hasPendingNative(realm)) {
      await new Promise<void>((resolve) => {
        const waiters = nativeIdleWaiters.get(realm) ?? []
        waiters.push(resolve)
        nativeIdleWaiters.set(realm, waiters)
      })
    }
    // Let promise continuations triggered by the native result drain. They may
    // enqueue another native operation before the realm is actually idle.
    await new Promise(resolve => setTimeout(resolve, 0))
    if (hasPendingNative(realm))
      continue
    if (!waitForReferencedResources)
      return
    const state: any = await nativeCall('resource.hasReferenced', null, realm)
    if (!state.referenced)
      return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

/**
 * Settles one WebView-to-Rust native operation.
 *
 * Triggering workflow:
 *
 * Rust `Runtime::resolve_native`
 *   -> `WebView::evaluate_script`
 *     -> `window.__ass.resolveNative`
 *       -> {@link resolveNative}
 *
 * Upstream:
 * - Rust native module host
 *
 * Downstream:
 * - {@link nativePending}
 */
const resolveNative = (id: number, success: boolean, value: unknown): void => {
  const pending = nativePending.get(id)
  if (!pending)
    return
  nativePending.delete(id)
  if (success) {
    pending.resolve(value)
  }
  else {
    const error = new Error(
      typeof value === 'object' && value && 'message' in value
        ? String(value.message)
        : String(value),
    )
    if (typeof value === 'object' && value)
      Object.assign(error, value, { message: error.message })
    if (!error.stack?.includes(error.message))
      error.stack = `${error.name}: ${error.message}\n${error.stack ?? ''}`
    pending.reject(error)
  }
  if (!hasPendingNative(pending.realm)) {
    const waiters = nativeIdleWaiters.get(pending.realm) ?? []
    nativeIdleWaiters.delete(pending.realm)
    for (const resolve of waiters)
      resolve()
  }
}

const consoleMethods = console as unknown as Record<
  (typeof consoleLevels)[number],
  (...values: unknown[]) => void
>

const consoleUsesColors = (level: (typeof consoleLevels)[number]): boolean => {
  // eslint-disable-next-line node/prefer-global/process
  const environment = globalThis.process?.env ?? {}
  if (Object.hasOwn(environment, 'FORCE_COLOR'))
    return environment.FORCE_COLOR !== '0'
  if (Object.hasOwn(environment, 'NO_COLOR'))
    return false
  // eslint-disable-next-line node/prefer-global/process
  const stream = level === 'warn' || level === 'error' ? globalThis.process.stderr : globalThis.process.stdout
  return Boolean((stream as undefined | { isTTY?: boolean })?.isTTY)
}

const formatUncaught = (error: unknown, fallback: string): string => {
  if (!(error instanceof Error))
    return fallback
  const heading = `${error.name || 'Error'}: ${error.message}`
  if (!error.stack)
    return heading
  return error.stack.includes(error.message) ? error.stack : `${heading}\n${error.stack}`
}

for (const level of consoleLevels) {
  const original = consoleMethods[level].bind(console)
  consoleMethods[level] = (...values) => {
    send({
      kind: 'console',
      level,
      text: values.map(value => inspect(value, { colors: consoleUsesColors(level) })).join(' '),
    })
    original(...values)
  }
}

/**
 * Forwards an uncaught window error to the native bridge.
 *
 * Triggering workflow:
 *
 * `window.error`
 *   -> `addEventListener`
 *     -> {@link handleError}
 *
 * Upstream:
 * - `window`
 *
 * Downstream:
 * - {@link send}
 */
const handleError = (event: ErrorEvent): void => {
  event.preventDefault()
  send({ kind: 'uncaught', realm: 0, text: formatUncaught(event.error, event.message) })
}

/**
 * Forwards an unhandled promise rejection to the native bridge.
 *
 * Triggering workflow:
 *
 * `window.unhandledrejection`
 *   -> `addEventListener`
 *     -> {@link handleUnhandledRejection}
 *
 * Upstream:
 * - `window`
 *
 * Downstream:
 * - {@link send}
 */
const handleUnhandledRejection = (event: PromiseRejectionEvent): void => {
  event.preventDefault()
  send({ kind: 'uncaught', realm: 0, text: formatUncaught(event.reason, inspect(event.reason)) })
}

addEventListener('error', handleError)
addEventListener('unhandledrejection', handleUnhandledRejection)

window.__ass = { closeNativeRealm, inspect, nativeCall, resolveNative, send, waitForNativeIdle }
globalThis.__assNativeCall = nativeCall
// eslint-disable-next-line node/prefer-global/process
globalThis.process = createProcess(
  globalThis.__assProcessSnapshot,
  (code) => {
    closeNativeRealm(0)
    send({ code, kind: 'exit', realm: 0 })
  },
  (stream, text) => send({
    kind: 'console',
    level: stream === 'stderr' ? 'error' : 'log',
    text,
  }),
)
