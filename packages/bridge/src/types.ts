export const consoleLevels = ['log', 'info', 'warn', 'error', 'debug'] as const

export type ConsoleLevel = (typeof consoleLevels)[number]

export interface IsolatedOutcome {
  display: string
  success: boolean
}

export interface NativeBridgeMessage {
  [key: string]: unknown
  kind: string
}

interface AssBridge {
  evaluateIsolated?: (
    source: string,
    module: boolean,
    moduleUrl?: null | string,
  ) => Promise<IsolatedOutcome>
  inspect: (value: unknown) => string
  send: (message: NativeBridgeMessage) => void
}

declare global {
  interface Window {
    __ass: AssBridge
    ipc: {
      postMessage: (message: string) => void
    }
  }
}
