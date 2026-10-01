import types from '@ass/node-builtin-modules/util/types'

export const TextDecoder = globalThis.TextDecoder
export const TextEncoder = globalThis.TextEncoder
export const MIMEType = globalThis.MIMEType
export const MIMEParams = globalThis.MIMEParams
export const transferableAbortController = () => new AbortController()
export const transferableAbortSignal = signal => signal
export const aborted = (signal, resource) => signal.aborted ? Promise.resolve() : new Promise(resolve => signal.addEventListener('abort', resolve.bind(null, resource), { once: true }))
export const inherits = (constructor, superConstructor) => { Object.setPrototypeOf(constructor.prototype, superConstructor.prototype); Object.setPrototypeOf(constructor, superConstructor) }
export const _extend = (target, source) => Object.assign(target, source)
export const promisify = (original) => {
  if (original[promisify.custom])
    return original[promisify.custom]
  return function (...args) { return new Promise((resolve, reject) => original.call(this, ...args, (error, ...values) => error ? reject(error) : resolve(values.length > 1 ? values : values[0]))) }
}
promisify.custom = Symbol.for('nodejs.util.promisify.custom')
export const callbackify = original => function (...args) {
  const callback = args.pop()
  Promise.resolve().then(() => original.apply(this, args)).then(value => queueMicrotask(() => callback(null, value)), error => queueMicrotask(() => callback(error || new Error('Promise was rejected with a falsy value'))))
}
const simpleInspect = (value, options: any = {}) => {
  if (typeof value === 'string')
    return options.colors ? value : `'${value.replace(/'/g, '\\\'')}'`
  if (typeof value === 'function')
    return `[Function${value.name ? `: ${value.name}` : ''}]`
  if (typeof value === 'bigint')
    return `${value}n`
  if (value instanceof Error)
    return value.stack ?? String(value)
  try { return JSON.stringify(value, (_key, nested) => typeof nested === 'bigint' ? `${nested}n` : nested, options.compact === false ? 2 : 0) ?? String(value) }
  catch { return String(value) }
}
export const inspect = Object.assign(simpleInspect, { colors: {}, custom: Symbol.for('nodejs.util.inspect.custom'), defaultOptions: {}, replDefaults: {}, styles: {} })
export const format = (first, ...args) => {
  if (typeof first !== 'string')
    return [first, ...args].map(value => inspect(value)).join(' ')
  let index = 0
  const output = first.replace(/%[sdifjoOc%]/g, (token) => {
    if (token === '%%')
      return '%'
    if (index >= args.length)
      return token
    const value = args[index++]
    if (token === '%s')
      return String(value)
    if (token === '%d' || token === '%i')
      return String(Number.parseInt(value, 10))
    if (token === '%f')
      return String(Number.parseFloat(value))
    if (token === '%j') {
      try { return JSON.stringify(value) }
      catch { return '[Circular]' }
    }
    return inspect(value, token === '%o' ? { showHidden: true } : {})
  })
  return [output, ...args.slice(index).map(value => typeof value === 'string' ? value : inspect(value))].join(' ')
}
export const formatWithOptions = (_options, ...args: any[]) => (format as (...values: any[]) => string)(...args)
export const stripVTControlCharacters = value => String(value).replace(/[\u001B\u009B][[\]()#;?]*(?:(?:[a-zA-Z\d]*(?:;[-\w/#&.:=?%@~]+)*)?\u0007|(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~])/g, '')
export const isDeepStrictEqual = (a, b) => {
  try { return JSON.stringify(a) === JSON.stringify(b) }
  catch { return a === b }
}
export const parseArgs = ({ strict = true, allowPositionals = !strict, args = [], options = {} } = {}) => {
  const values = {}; const positionals = []; const tokens = []
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    if (argument.startsWith('--')) {
      const [name, inline] = argument.slice(2).split('=', 2); const definition = options[name]
      if (!definition && strict)
        throw new TypeError(`Unknown option '--${name}'`)
      const value = definition?.type === 'boolean' ? true : inline ?? args[++index]
      if (definition?.multiple)
        (values[name] ??= []).push(value); else values[name] = value
      tokens.push({ index, inlineValue: inline !== undefined, kind: 'option', name, rawName: `--${name}`, value })
    }
    else {
      if (!allowPositionals)
        throw new TypeError(`Unexpected argument '${argument}'`); positionals.push(argument); tokens.push({ index, kind: 'positional', value: argument })
    }
  }
  return { positionals, tokens, values }
}
export { types }
export const toUSVString = value => String(value).toWellFormed ? String(value).toWellFormed() : String(value)
export const deprecate = function_ => function_
export const debuglog = () => () => {}
export const log = (...args) => console.log(...args)
export default { _extend, aborted, callbackify, debuglog, deprecate, format, formatWithOptions, inherits, inspect, isDeepStrictEqual, log, parseArgs, promisify, stripVTControlCharacters, TextDecoder, TextEncoder, toUSVString, transferableAbortController, transferableAbortSignal, types }
