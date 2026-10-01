const makePath = (separator, delimiter) => {
  const split = value => String(value).replace(/[\\/]+/g, separator).split(separator)
  const isAbsolute = value => separator === '\\' ? /^[a-z]:[\\/]|^[\\/]{2}/i.test(value) : String(value).startsWith('/')
  const normalize = (value) => {
    value = String(value)
    if (!value)
      return '.'
    const absolute = isAbsolute(value)
    const prefix = separator === '\\' && /^[a-z]:/i.test(value) ? value.slice(0, 2) : ''
    const result = []
    for (const part of split(value.replace(/^[a-z]:/i, ''))) {
      if (!part || part === '.')
        continue
      if (part === '..') {
        if (result.length && result.at(-1) !== '..')
          result.pop()
        else if (!absolute)
          result.push(part)
      }
      else {
        result.push(part)
      }
    }
    const root = absolute ? `${prefix}${separator}` : prefix
    return root + result.join(separator) || (absolute ? separator : '.')
  }
  const join = (...parts) => normalize(parts.filter(Boolean).join(separator))
  const resolve = (...parts) => {
    let result = ''
    for (let index = parts.length - 1; index >= -1; index--) {
      const part = index >= 0 ? parts[index] : '/'
      result = `${part}${separator}${result}`
      if (isAbsolute(part))
        break
    }
    return normalize(result)
  }
  const dirname = (value) => {
    const normalized = normalize(value)
    const index = normalized.lastIndexOf(separator)
    if (index < 0)
      return '.'
    return normalized.slice(0, index) || separator
  }
  const basename = (value, suffix?) => {
    let result = normalize(value).split(separator).at(-1) || ''
    if (suffix && result.endsWith(suffix))
      result = result.slice(0, -suffix.length)
    return result
  }
  const extname = (value) => {
    const base = basename(value); const index = base.lastIndexOf('.')
    return index <= 0 ? '' : base.slice(index)
  }
  const parse = (value) => {
    const dir = dirname(value); const base = basename(value); const ext = extname(value)
    const root = isAbsolute(value) ? (separator === '\\' && /^[a-z]:/i.test(value) ? `${value.slice(0, 2)}${separator}` : separator) : ''
    return { base, dir, ext, name: base.slice(0, base.length - ext.length), root }
  }
  const format = value => value.dir ? join(value.dir, value.base ?? `${value.name ?? ''}${value.ext ?? ''}`) : `${value.root ?? ''}${value.base ?? `${value.name ?? ''}${value.ext ?? ''}`}`
  const relative = (from, to) => {
    const fromParts = split(resolve(from)).filter(Boolean); const toParts = split(resolve(to)).filter(Boolean)
    while (fromParts.length && toParts.length && fromParts[0].toLowerCase() === toParts[0].toLowerCase()) { fromParts.shift(); toParts.shift() }
    return [...fromParts.map(() => '..'), ...toParts].join(separator)
  }
  const toNamespacedPath = value => separator === '\\' && isAbsolute(value) ? `\\\\?\\${normalize(value)}` : value
  return { basename, delimiter, dirname, extname, format, isAbsolute, join, normalize, parse, posix: undefined, relative, resolve, sep: separator, toNamespacedPath, win32: undefined }
}
export const posix = makePath('/', ':')
export const win32 = makePath('\\', ';')
posix.posix = posix; posix.win32 = win32; win32.posix = posix; win32.win32 = win32
const selected = /Windows/i.test(navigator.userAgent) ? win32 : posix
export const { basename, delimiter, dirname, extname, format, isAbsolute, join, normalize, parse, relative, resolve, sep, toNamespacedPath } = selected
export default selected
