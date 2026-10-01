export const setTimeout = globalThis.setTimeout.bind(globalThis)
export const clearTimeout = globalThis.clearTimeout.bind(globalThis)
export const setInterval = globalThis.setInterval.bind(globalThis)
export const clearInterval = globalThis.clearInterval.bind(globalThis)
export const setImmediate = (callback, ...args) => setTimeout(callback, 0, ...args)
export const clearImmediate = clearTimeout
export default { clearImmediate, clearInterval, clearTimeout, setImmediate, setInterval, setTimeout }
