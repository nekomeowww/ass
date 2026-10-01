export type Inspect = (value: unknown, options?: InspectOptions) => string

export interface InspectOptions {
  colors?: boolean
}

export const inspect: Inspect = (input, options = {}) => {
  const color = (value: string, code: number, reset: number, enabled: boolean): string =>
    enabled ? `\u001B[${code}m${value}\u001B[${reset}m` : value
  const inspectValue = (
    value: unknown,
    seen: WeakSet<object>,
    depth: number,
    colors: boolean,
  ): string => {
    const quoteString = (input: string): string => `'${input
      .replace(/\\/g, '\\\\')
      .replace(/'/g, '\\\'')
      .replace(/\n/g, '\\n')}'`
    if (value === undefined)
      return color('undefined', 90, 39, colors)
    if (value === null)
      return color('null', 1, 22, colors)
    if (typeof value === 'string')
      return depth ? color(quoteString(value), 32, 39, colors) : value
    if (typeof value === 'bigint')
      return color(`${value}n`, 33, 39, colors)
    if (typeof value === 'symbol')
      return color(value.toString(), 32, 39, colors)
    if (typeof value === 'function')
      return color(`[Function${value.name ? `: ${value.name}` : ''}]`, 36, 39, colors)
    if (typeof value === 'number')
      return color(String(value), 33, 39, colors)
    if (typeof value === 'boolean')
      return color(String(value), 33, 39, colors)
    if (value instanceof Error)
      return value.stack || `${value.name}: ${value.message}`
    if (value instanceof Date)
      return color(Number.isNaN(value.valueOf()) ? 'Invalid Date' : value.toISOString(), 35, 39, colors)
    if (value instanceof RegExp)
      return color(value.toString(), 31, 39, colors)
    if (value instanceof Uint8Array) {
      let bufferLike = value.constructor.name === 'Buffer'
      if (!bufferLike && 'toJSON' in value && typeof value.toJSON === 'function') {
        try {
          bufferLike = value.toJSON()?.type === 'Buffer'
        }
        catch {
        // Ignore custom toJSON failures and use the generic object formatter.
        }
      }
      if (bufferLike) {
        const limit = Math.min(value.byteLength, 50)
        const preview = Array.from(
          value.subarray(0, limit),
          byte => byte.toString(16).padStart(2, '0'),
        ).join(' ')
        const remaining = value.byteLength - limit
        return `<Buffer ${preview}${remaining ? ` ... ${remaining} more bytes` : ''}>`
      }
    }
    if (Array.isArray(value)) {
      if (seen.has(value))
        return '[Circular]'
      seen.add(value)
      const entries = value.map(entry => inspectValue(entry, seen, depth + 1, colors))
      const inline = `[ ${entries.join(', ')} ]`
      if (inline.length <= 80)
        return inline
      if (entries.every(entry => entry.startsWith('\''))) {
        const rendered = entries.map((entry, index) =>
          index + 1 < entries.length ? `${entry},` : entry)
        const firstColumnWidth = Math.max(
          ...rendered.filter((_, index) => index % 2 === 0).map(entry => entry.length),
        ) + 1
        const lines: string[] = []
        const indentation = '  '.repeat(depth + 1)
        for (let index = 0; index < rendered.length; index += 2) {
          const first = rendered[index]
          const second = rendered[index + 1]
          lines.push(second ? `${indentation}${first.padEnd(firstColumnWidth)}${second}` : `${indentation}${first}`)
        }
        return `[\n${lines.join('\n')}\n${'  '.repeat(depth)}]`
      }
      const indentation = '  '.repeat(depth + 1)
      return `[\n${entries.map((entry, index) =>
        `${indentation}${entry}${index + 1 < entries.length ? ',' : ''}`).join('\n')}\n${'  '.repeat(depth)}]`
    }
    if (value instanceof Set) {
      if (seen.has(value))
        return '[Circular]'
      seen.add(value)
      const entries = [...value].map(entry => inspectValue(entry, seen, depth + 1, colors))
      return `Set(${value.size}) {${entries.length ? ` ${entries.join(', ')} ` : ''}}`
    }
    if (value instanceof Map) {
      if (seen.has(value))
        return '[Circular]'
      seen.add(value)
      const entries = [...value].map(([key, entry]) =>
        `${inspectValue(key, seen, depth + 1, colors)} => ${inspectValue(entry, seen, depth + 1, colors)}`)
      return `Map(${value.size}) {${entries.length ? ` ${entries.join(', ')} ` : ''}}`
    }
    if (value && typeof value === 'object') {
      if (seen.has(value))
        return '[Circular]'
      seen.add(value)
      const entries = Object.keys(value).map((key) => {
        let nested: unknown
        try {
          nested = (value as Record<string, unknown>)[key]
        }
        catch (error) {
          nested = error
        }
        const formattedKey = /^[A-Z_$][\w$]*$/i.test(key) ? key : quoteString(key)
        return `${formattedKey}: ${inspectValue(nested, seen, depth + 1, colors)}`
      })
      const tag = Object.prototype.toString.call(value) === '[object process]' ? 'process ' : ''
      if (!entries.length)
        return `${tag}{}`
      const inline = `${tag}{ ${entries.join(', ')} }`
      if (inline.length <= 80 && !inline.includes('\n'))
        return inline
      const indentation = '  '.repeat(depth + 1)
      const closingIndentation = '  '.repeat(depth)
      return `${tag}{\n${entries.map(entry =>
        `${indentation}${entry.replace(/\n/g, `\n${indentation}`)}`).join(',\n')}\n${closingIndentation}}`
    }
    return String(value)
  }
  return inspectValue(input, new WeakSet(), 0, options.colors ?? false)
}
