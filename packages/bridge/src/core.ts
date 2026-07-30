import type { NativeBridgeMessage } from './types'

import { inspect } from './inspect'
import { consoleLevels } from './types'

const send = (message: NativeBridgeMessage): void => {
  window.ipc.postMessage(JSON.stringify(message))
}

const consoleMethods = console as unknown as Record<
  (typeof consoleLevels)[number],
  (...values: unknown[]) => void
>

for (const level of consoleLevels) {
  const original = consoleMethods[level].bind(console)
  consoleMethods[level] = (...values) => {
    send({
      kind: 'console',
      level,
      text: values.map(value => inspect(value)).join(' '),
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
  send({ kind: 'uncaught', text: event.error?.stack || event.message })
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
  send({ kind: 'uncaught', text: inspect(event.reason) })
}

addEventListener('error', handleError)
addEventListener('unhandledrejection', handleUnhandledRejection)

window.__ass = { inspect, send }
