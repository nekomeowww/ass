const unescape = (value, decode = decodeURIComponent) => {
  try { return decode(value.replace(/\+/g, ' ')) }
  catch { return value }
}
export const parse = (input, sep = '&', eq = '=', options: any = {}) => {
  const result = Object.create(null)
  if (typeof input !== 'string' || !input)
    return result
  const decode = options.decodeURIComponent ?? decodeURIComponent
  for (const entry of input.split(sep, options.maxKeys > 0 ? options.maxKeys : undefined)) {
    const index = entry.indexOf(eq)
    const key = unescape(index < 0 ? entry : entry.slice(0, index), decode)
    const value = unescape(index < 0 ? '' : entry.slice(index + eq.length), decode)
    result[key] = key in result ? [].concat(result[key], value) : value
  }
  return result
}
export const stringify = (value, sep = '&', eq = '=', options: any = {}) => {
  const encode = options.encodeURIComponent ?? encodeURIComponent
  return Object.entries(value ?? {}).flatMap(([key, item]) => {
    const values = Array.isArray(item) ? item : [item]
    return values.map(entry => `${encode(key)}${eq}${encode(entry == null || typeof entry === 'object' ? '' : String(entry))}`)
  }).join(sep)
}
export const decode = parse
export const encode = stringify
export { unescape }
export const escape = encodeURIComponent
export const unescapeBuffer = value => new TextEncoder().encode(unescape(value))
export default { decode, encode, escape, parse, stringify, unescape, unescapeBuffer }
