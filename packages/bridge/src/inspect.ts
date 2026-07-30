export type Inspect = (value: unknown, seen?: WeakSet<object>) => string

export const inspect: Inspect = (value, seen = new WeakSet()) => {
  if (value === undefined)
    return 'undefined'
  if (typeof value === 'string')
    return value
  if (typeof value === 'bigint')
    return `${value}n`
  if (typeof value === 'symbol' || typeof value === 'function')
    return value.toString()
  if (typeof value === 'number' && !Number.isFinite(value))
    return String(value)
  if (value instanceof Error)
    return value.stack || `${value.name}: ${value.message}`
  if (value && typeof value === 'object') {
    if (seen.has(value))
      return '[Circular]'
    seen.add(value)
    try {
      return (
        JSON.stringify(value, (_key, nested) =>
          typeof nested === 'bigint' ? `${nested}n` : nested) ?? Object.prototype.toString.call(value)
      )
    }
    catch {
      return Object.prototype.toString.call(value)
    }
  }
  return String(value)
}
