import type { Inspect } from './inspect'
import type { ConsoleLevel, IsolatedOutcome, NativeBridgeMessage } from './types'

import { inspect } from './inspect'

interface IsolatedMessage {
  channel: 'ass-isolated-realm'
  display?: string
  kind: 'console' | 'ready' | 'result'
  level?: ConsoleLevel
  success?: boolean
  text?: string
  token?: number
}

interface IsolatedRequest {
  channel: 'ass-isolated-request'
  module: boolean
  moduleUrl: null | string
  source: string
  token: number
}

const { send } = window.__ass

const isolatedRealmBootstrap = (inspectValue: Inspect): void => {
  const levels: readonly ConsoleLevel[] = ['log', 'info', 'warn', 'error', 'debug']
  const post = (message: Omit<IsolatedMessage, 'channel'>): void => {
    parent.postMessage({ channel: 'ass-isolated-realm', ...message }, '*')
  }
  const consoleMethods = console as unknown as Record<
    ConsoleLevel,
    (...values: unknown[]) => void
  >

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
    const { module, moduleUrl, source, token } = request

    for (const level of levels) {
      consoleMethods[level] = (...values) => {
        post({
          kind: 'console',
          level,
          text: values.map(value => inspectValue(value)).join(' '),
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
      post({ display: inspectValue(value), kind: 'result', success: true, token })
    }
    catch (error) {
      post({ display: inspectValue(error), kind: 'result', success: false, token })
    }
  }

  addEventListener('message', handleRequest)
  post({ kind: 'ready' })
}

let nextRealmToken = 1

window.__ass.evaluateIsolated = (source, module, moduleUrl = null) =>
  new Promise<IsolatedOutcome>((resolve) => {
    const iframe = document.createElement('iframe')
    iframe.hidden = true
    iframe.setAttribute('sandbox', 'allow-scripts')
    const token = nextRealmToken++
    let onMessage: (event: MessageEvent<IsolatedMessage>) => void
    const cleanup = (): void => {
      removeEventListener('message', onMessage)
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
          { channel: 'ass-isolated-request', module, moduleUrl, source, token },
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
      else if (message.token === token && message.kind === 'result') {
        cleanup()
        resolve({ display: message.display ?? 'undefined', success: Boolean(message.success) })
      }
    }

    addEventListener('message', onMessage)
    iframe.srcdoc = `<!doctype html><script>(${isolatedRealmBootstrap.toString()})(${inspect.toString()})</script>`
    document.documentElement.append(iframe)
  })
