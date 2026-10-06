import type { Inspect } from './inspect'
import type { ProcessSnapshot } from './process'
import type { ConsoleLevel, IsolatedOutcome, NativeBridgeMessage } from './types'

import { inspect } from './inspect'
import { createProcess } from './process'

interface IsolatedMessage {
  channel: 'ass-isolated-realm'
  code?: number
  display?: string
  id?: number
  kind: 'console' | 'native' | 'native-result' | 'process-exit' | 'ready' | 'result' | 'uncaught'
  level?: ConsoleLevel
  method?: string
  success?: boolean
  text?: string
  token?: number
  value?: unknown
}

interface IsolatedRequest {
  bufferModuleUrl: string
  channel: 'ass-isolated-request'
  module: boolean
  moduleUrl: null | string
  osSnapshot: unknown
  processSnapshot: ProcessSnapshot
  source: string
  token: number
}

const { send } = window.__ass

const isolatedRealmBootstrap = (
  inspectValue: Inspect,
  createProcessValue: typeof createProcess,
): void => {
  const levels: readonly ConsoleLevel[] = ['log', 'info', 'warn', 'error', 'debug']
  const post = (message: Omit<IsolatedMessage, 'channel'>): void => {
    parent.postMessage({ channel: 'ass-isolated-realm', ...message }, '*')
  }
  const consoleMethods = console as unknown as Record<
    ConsoleLevel,
    (...values: unknown[]) => void
  >
  const consoleUsesColors = (level: ConsoleLevel): boolean => {
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
  let nextNativeId = 1
  const nativePending = new Map<number, {
    reject: (reason: Error) => void
    resolve: (value: unknown) => void
  }>()
  const nativeIdleWaiters: Array<() => void> = []
  let currentToken = 0

  const formatUncaught = (error: unknown, fallback: string): string => {
    if (!(error instanceof Error))
      return fallback
    const heading = `${error.name || 'Error'}: ${error.message}`
    if (!error.stack)
      return heading
    return error.stack.includes(error.message) ? error.stack : `${heading}\n${error.stack}`
  }

  const waitForNativeIdle = async (): Promise<void> => {
    while (true) {
      while (nativePending.size) {
        await new Promise<void>((resolve) => {
          nativeIdleWaiters.push(resolve)
        })
      }
      await new Promise(resolve => setTimeout(resolve, 0))
      if (nativePending.size)
        continue
      const state: any = await globalThis.__assNativeCall('resource.hasReferenced')
      if (!state.referenced)
        return
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }

  globalThis.__assNativeCall = (method, args = null) =>
    new Promise((resolve, reject) => {
      const id = nextNativeId++
      nativePending.set(id, { reject, resolve })
      post({ id, kind: 'native', method, token: currentToken, value: args })
    })

  /**
   * Settles a native request forwarded through the parent realm.
   *
   * Triggering workflow:
   *
   * parent `window.__ass.nativeCall`
   *   -> `postMessage`
   *     -> `ass-isolated-realm/native-result`
   *       -> {@link handleNativeResult}
   *
   * Upstream:
   * - parent frame message router
   *
   * Downstream:
   * - native request promise stored in `nativePending`
   */
  const handleNativeResult = (event: MessageEvent<IsolatedMessage>): void => {
    const message = event.data
    if (
      event.source !== parent
      || message?.channel !== 'ass-isolated-realm'
      || message.kind !== 'native-result'
      || message.token !== currentToken
      || message.id === undefined
    ) {
      return
    }
    const pending = nativePending.get(message.id)
    if (!pending)
      return
    nativePending.delete(message.id)
    if (message.success) {
      pending.resolve(message.value)
    }
    else {
      const value = message.value
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
    if (!nativePending.size) {
      for (const resolve of nativeIdleWaiters.splice(0))
        resolve()
    }
  }

  /**
   * Forwards an uncaught isolated-frame error to the parent realm.
   *
   * Triggering workflow:
   *
   * `window.error`
   *   -> `addEventListener`
   *     -> {@link handleIsolatedError}
   *
   * Upstream:
   * - isolated frame `window`
   *
   * Downstream:
   * - {@link post} with the `uncaught` message type
   */
  const handleIsolatedError = (event: ErrorEvent): void => {
    event.preventDefault()
    post({ kind: 'uncaught', text: formatUncaught(event.error, event.message), token: currentToken })
  }

  /**
   * Forwards an unhandled isolated-frame rejection to the parent realm.
   *
   * Triggering workflow:
   *
   * `window.unhandledrejection`
   *   -> `addEventListener`
   *     -> {@link handleIsolatedRejection}
   *
   * Upstream:
   * - isolated frame `window`
   *
   * Downstream:
   * - {@link post} with the `uncaught` message type
   */
  const handleIsolatedRejection = (event: PromiseRejectionEvent): void => {
    event.preventDefault()
    post({ kind: 'uncaught', text: formatUncaught(event.reason, inspectValue(event.reason)), token: currentToken })
  }

  /**
   * Executes one request delivered by the parent bridge.
   *
   * Triggering workflow:
   *
   * `ass-isolated-request`
   *   -> `window.message`
   *     -> `addEventListener`
   *       -> {@link handleRequest}
   *
   * Upstream:
   * - parent frame `postMessage`
   *
   * Downstream:
   * - {@link post}
   */
  const handleRequest = async (event: MessageEvent<IsolatedRequest>): Promise<void> => {
    const request = event.data
    if (event.source !== parent || request?.channel !== 'ass-isolated-request')
      return
    const { bufferModuleUrl, module, moduleUrl, osSnapshot, processSnapshot, source, token } = request
    currentToken = token
    const bufferModule: any = await import(bufferModuleUrl)
    Object.assign(globalThis, { Buffer: bufferModule.Buffer })
    globalThis.__assOsSnapshot = osSnapshot
    // eslint-disable-next-line node/prefer-global/process
    globalThis.process = createProcessValue(
      processSnapshot,
      code => post({ code, kind: 'process-exit', token }),
      (stream, text) => post({
        kind: 'console',
        level: stream === 'stderr' ? 'error' : 'log',
        text,
        token,
      }),
    )

    for (const level of levels) {
      consoleMethods[level] = (...values) => {
        post({
          kind: 'console',
          level,
          text: values.map(value => inspectValue(value, { colors: consoleUsesColors(level) })).join(' '),
          token,
        })
      }
    }

    try {
      let value: unknown
      if (module) {
        if (moduleUrl) {
          value = await import(moduleUrl)
        }
        else {
          const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
          try {
            value = await import(url)
          }
          finally {
            URL.revokeObjectURL(url)
          }
        }
      }
      else {
        value = await (0, eval)(source)
      }
      await waitForNativeIdle()
      post({ display: inspectValue(value), kind: 'result', success: true, token })
    }
    catch (error) {
      post({ display: inspectValue(error), kind: 'result', success: false, token })
    }
  }

  addEventListener('message', handleRequest)
  addEventListener('message', handleNativeResult)
  addEventListener('error', handleIsolatedError)
  addEventListener('unhandledrejection', handleIsolatedRejection)
  post({ kind: 'ready' })
}

let nextRealmToken = 1

window.__ass.evaluateIsolated = (source, module, moduleUrl = null, realm = 0) =>
  new Promise<IsolatedOutcome>((resolve) => {
    const iframe = document.createElement('iframe')
    iframe.hidden = true
    iframe.setAttribute('sandbox', 'allow-scripts')
    const token = nextRealmToken++
    let onMessage: (event: MessageEvent<IsolatedMessage>) => void
    const cleanup = (): void => {
      removeEventListener('message', onMessage)
      window.__ass.closeNativeRealm(realm)
      iframe.remove()
    }

    /**
     * Routes sandbox output back to the native IPC bridge.
     *
     * Triggering workflow:
     *
     * `ass-isolated-realm`
     *   -> `window.message`
     *     -> `addEventListener`
     *       -> {@link onMessage}
     *
     * Upstream:
     * - sandbox frame `postMessage`
     *
     * Downstream:
     * - {@link send}, {@link cleanup}, or the request promise's `resolve`
     */
    onMessage = (event: MessageEvent<IsolatedMessage>): void => {
      if (
        event.source !== iframe.contentWindow
        || event.data?.channel !== 'ass-isolated-realm'
      ) {
        return
      }
      const message = event.data
      if (message.kind === 'ready') {
        iframe.contentWindow?.postMessage(
          { bufferModuleUrl: `ass://module/${realm}/__ass_builtin__/buffer`, channel: 'ass-isolated-request', module, moduleUrl, osSnapshot: globalThis.__assOsSnapshot, processSnapshot: globalThis.__assProcessSnapshot, source, token },
          '*',
        )
      }
      else if (message.token === token && message.kind === 'console') {
        send({
          kind: 'console',
          level: message.level,
          text: message.text,
        } as NativeBridgeMessage)
      }
      else if (
        message.token === token
        && message.kind === 'native'
        && message.id !== undefined
        && message.method
      ) {
        const id = message.id
        window.__ass.nativeCall(message.method, message.value, realm).then(
          value => iframe.contentWindow?.postMessage({
            channel: 'ass-isolated-realm',
            id,
            kind: 'native-result',
            success: true,
            token,
            value,
          }, '*', value instanceof ArrayBuffer ? [value] : []),
          error => iframe.contentWindow?.postMessage({
            channel: 'ass-isolated-realm',
            id,
            kind: 'native-result',
            success: false,
            token,
            value: {
              code: error?.code,
              message: error?.message ?? String(error),
              path: error?.path,
              syscall: error?.syscall,
            },
          }, '*'),
        )
      }
      else if (
        message.token === token
        && message.kind === 'process-exit'
        && message.code !== undefined
      ) {
        send({ code: message.code, kind: 'exit', realm })
        cleanup()
      }
      else if (message.token === token && message.kind === 'uncaught') {
        send({ kind: 'uncaught', realm, text: message.text })
        cleanup()
      }
      else if (message.token === token && message.kind === 'result') {
        cleanup()
        resolve({ display: message.display ?? 'undefined', success: Boolean(message.success) })
      }
    }

    addEventListener('message', onMessage)
    iframe.srcdoc = `<!doctype html><script>(${isolatedRealmBootstrap.toString()})(${inspect.toString()},${createProcess.toString()})</script>`
    document.documentElement.append(iframe)
  })
