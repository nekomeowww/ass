const isWindowsPath = value => /^[a-z]:[\\/]/i.test(value)
export const domainToASCII = (domain) => {
  try { return new URL(`http://${domain}`).hostname }
  catch { return '' }
}
export const domainToUnicode = domain => domain
export const pathToFileURL = (path) => {
  const windows = isWindowsPath(path)
  const normalized = String(path).replace(/\\/g, '/')
  const absolute = windows || normalized.startsWith('/') ? normalized : `/${normalized}`
  return new URL(`file://${absolute.split('/').map((part, index) => index ? encodeURIComponent(part) : part).join('/')}`)
}
export const fileURLToPath = (value) => {
  const url = value instanceof URL ? value : new URL(value)
  if (url.protocol !== 'file:')
    throw Object.assign(new TypeError('The URL must be of scheme file'), { code: 'ERR_INVALID_URL_SCHEME' })
  const path = decodeURIComponent(url.pathname)
  return /^\/[a-z]:/i.test(path) ? path.slice(1).replace(/\//g, '\\') : path
}
export const urlToHttpOptions = (value) => {
  const url = value instanceof URL ? value : new URL(value)
  return { auth: url.username ? `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}` : undefined, hash: url.hash, hostname: url.hostname, href: url.href, path: `${url.pathname}${url.search}`, pathname: url.pathname, port: url.port, protocol: url.protocol, search: url.search }
}
export const resolve = (from, to) => new URL(to, from).href
export const resolveObjectURL = value => value.startsWith('blob:') ? new URL(value) : undefined
export const URL = globalThis.URL
export const URLSearchParams = globalThis.URLSearchParams
export const URLPattern = globalThis.URLPattern
export const parse = (value, parseQueryString = false) => {
  try {
    const url = new URL(value)
    return { auth: url.username ? `${url.username}:${url.password}` : null, hash: url.hash || null, host: url.host, hostname: url.hostname, href: url.href, path: `${url.pathname}${url.search}`, pathname: url.pathname, port: url.port || null, protocol: url.protocol, query: parseQueryString ? Object.fromEntries(url.searchParams) : url.search.slice(1), search: url.search || null, slashes: true }
  }
  catch { return null }
}
export const format = value => value instanceof globalThis.URL ? value.href : value.href ?? String(value)
export default { domainToASCII, domainToUnicode, fileURLToPath, format, parse, pathToFileURL, resolve, resolveObjectURL, URL, URLPattern, URLSearchParams, urlToHttpOptions }
