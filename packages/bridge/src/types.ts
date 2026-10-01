import type { AssProcess, ProcessSnapshot } from './process'

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
  closeNativeRealm: (realm: number) => void
  evaluateIsolated?: (
    source: string,
    module: boolean,
    moduleUrl?: null | string,
    realm?: number,
  ) => Promise<IsolatedOutcome>
  inspect: (value: unknown) => string
  nativeCall: (method: string, args?: unknown, realm?: number) => Promise<unknown>
  resolveNative: (id: number, success: boolean, value: unknown) => void
  send: (message: NativeBridgeMessage) => void
  waitForNativeIdle: (realm?: number, waitForReferencedResources?: boolean) => Promise<void>
}

declare global {
  // Built-in ESM modules use this realm-local hook. The isolated realm replaces
  // it with a postMessage proxy because sandboxed frames cannot access parent.
  // eslint-disable-next-line vars-on-top
  var __assNativeCall: (method: string, args?: unknown) => Promise<unknown>
  // eslint-disable-next-line vars-on-top
  var __assOsSnapshot: unknown
  // eslint-disable-next-line vars-on-top
  var __assProcessSnapshot: ProcessSnapshot
  // eslint-disable-next-line vars-on-top
  var process: AssProcess
}

declare global {
  interface Window {
    __ass: AssBridge
    ipc: {
      postMessage: (message: string) => void
    }
  }
}
