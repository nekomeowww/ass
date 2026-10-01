import { Buffer } from '@ass/node-builtin-modules/buffer'

declare global {
  // eslint-disable-next-line vars-on-top
  var __assNativeCall: (name: string, args?: unknown) => Promise<any>
}

export const op = <T = any>(name: string, args: unknown = null): Promise<T> =>
  globalThis.__assNativeCall(name, args)

export const setResourceReferenced = (resource: number | undefined, referenced: boolean): void => {
  if (resource !== undefined)
    void op('resource.setReferenced', { referenced, resource })
}

export const bytesToBase64 = value => Buffer.from(value).toString('base64')
export const base64ToBytes = value => Buffer.from(value, 'base64')

export const unsupportedSync = (name: string): never => {
  const error = new Error(`${name} is unavailable: ass cannot provide synchronous native operations through a system WebView`)
  throw Object.assign(error, { code: 'ERR_ASS_SYNC_UNSUPPORTED' })
}

export const callback = (promise: Promise<any>, done: (...args: any[]) => void, transform = (value: any): any => value): void => {
  promise.then(
    value => queueMicrotask(() => done(null, transform(value))),
    error => queueMicrotask(() => done(error)),
  )
}
