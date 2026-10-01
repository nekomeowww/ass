export const builtinModules = [
  '_http_agent',
  '_http_client',
  '_http_common',
  '_http_incoming',
  '_http_outgoing',
  '_http_server',
  '_stream_duplex',
  '_stream_passthrough',
  '_stream_readable',
  '_stream_transform',
  '_stream_wrap',
  '_stream_writable',
  '_tls_common',
  '_tls_wrap',
  'assert',
  'assert/strict',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'diagnostics_channel',
  'dns',
  'dns/promises',
  'domain',
  'events',
  'fs',
  'fs/promises',
  'http',
  'http2',
  'https',
  'inspector',
  'inspector/promises',
  'module',
  'net',
  'os',
  'path',
  'path/posix',
  'path/win32',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'readline/promises',
  'repl',
  'stream',
  'stream/consumers',
  'stream/promises',
  'stream/web',
  'string_decoder',
  'sys',
  'timers',
  'timers/promises',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'util/types',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib',
  'node:sea',
  'node:sqlite',
  'node:test',
  'node:test/reporters',
]

const builtinSet = new Set(builtinModules)
const unsupportedSync = (name) => {
  const error = new Error(`${name} is unavailable: ass does not provide a synchronous CommonJS module loader`)
  throw Object.assign(error, { code: 'ERR_ASS_SYNC_UNSUPPORTED' })
}

export const isBuiltin = name => builtinSet.has(name) || (name.startsWith('node:') && builtinSet.has(name.slice(5)))
export const constants = Object.assign(Object.create(null), { compileCacheStatus: Object.assign(Object.create(null), { ALREADY_ENABLED: 2, DISABLED: 3, ENABLED: 1, FAILED: 0 }) })
export const globalPaths: string[] = []
export const createRequire = () => {
  const require = () => unsupportedSync('module.createRequire')
  require.cache = Object.create(null)
  require.extensions = Object.create(null)
  require.main = undefined
  require.resolve = () => unsupportedSync('require.resolve')
  return require
}

let sourceMapsSupport = { enabled: false, generatedCode: false, nodeModules: false }
export const getSourceMapsSupport = () => Object.assign(Object.create(null), sourceMapsSupport)
export const setSourceMapsSupport = (enabled, options: any = {}) => {
  sourceMapsSupport = typeof enabled === 'object'
    ? { enabled: true, generatedCode: enabled.generatedCode ?? false, nodeModules: enabled.nodeModules ?? false }
    : { enabled: Boolean(enabled), generatedCode: options.generatedCode ?? false, nodeModules: options.nodeModules ?? false }
}
export const syncBuiltinESMExports = () => {}

export class Module {
  static builtinModules = builtinModules
  static constants = constants
  static createRequire = createRequire
  static isBuiltin = isBuiltin
  children: Module[] = []
  exports: any = {}
  filename: null | string = null
  id: string
  isPreloading = false
  loaded = false
  parent: Module | null
  path: null | string = null
  paths: string[] = []

  constructor(id = '', parent: Module | null = null) {
    this.id = id
    this.parent = parent
    parent?.children.push(this)
  }

  require(_id) { return unsupportedSync('module.require') }
}

export default Module
