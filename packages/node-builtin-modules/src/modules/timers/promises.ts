interface TimerOptions {
  signal?: AbortSignal
}

export const setTimeout = (delay = 1, value?: any, options: TimerOptions = {}) => new Promise((resolve, reject) => {
  if (options.signal?.aborted)
    return reject(options.signal.reason)
  const timer = globalThis.setTimeout(resolve, delay, value)
  options.signal?.addEventListener('abort', () => { globalThis.clearTimeout(timer); reject(options.signal.reason) }, { once: true })
})
export const setImmediate = (value?: any, options?: TimerOptions) => setTimeout(0, value, options)
export async function* setInterval(delay = 1, value?: any, options: TimerOptions = {}) {
  while (!options.signal?.aborted) {
    await setTimeout(delay, undefined, options)
    yield value
  }
}
export const scheduler = { wait: setTimeout, yield: () => setImmediate() }
export default { scheduler, setImmediate, setInterval, setTimeout }
