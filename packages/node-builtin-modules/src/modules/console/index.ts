import { format, formatWithOptions } from '@ass/node-builtin-modules/util'

const bind = name => (...args) => globalThis.console[name](...args)

export const assert = bind('assert')
export const clear = bind('clear')
export const count = bind('count')
export const countReset = bind('countReset')
export const debug = bind('debug')
export const dir = bind('dir')
export const dirxml = bind('dirxml')
export const error = bind('error')
export const group = bind('group')
export const groupCollapsed = bind('groupCollapsed')
export const groupEnd = bind('groupEnd')
export const info = bind('info')
export const log = bind('log')
export const profile = bind('profile')
export const profileEnd = bind('profileEnd')
export const table = bind('table')
export const time = bind('time')
export const timeEnd = bind('timeEnd')
export const timeLog = bind('timeLog')
export const timeStamp = bind('timeStamp')
export const trace = bind('trace')
export const warn = bind('warn')

export class Console {
  _groupIndent = ''
  _ignoreErrors: boolean
  _stderr: any
  _stdout: any
  _times = new Map<string, number>()

  constructor(stdoutOrOptions, stderr?, ignoreErrors = true) {
    const options = stdoutOrOptions?.stdout ? stdoutOrOptions : { colorMode: 'auto', ignoreErrors, stderr, stdout: stdoutOrOptions }
    this._stdout = options.stdout
    this._stderr = options.stderr ?? options.stdout
    this._ignoreErrors = options.ignoreErrors ?? true
  }

  _write(stream, args) {
    const message = `${this._groupIndent}${(formatWithOptions as (...values: any[]) => string)({}, ...args)}\n`
    try { stream.write(message) }
    catch (error) {
      if (!this._ignoreErrors)
        throw error
    }
  }

  assert(value, ...args) {
    if (!value)
      this.error(args.length ? `Assertion failed: ${(format as (...values: any[]) => string)(...args)}` : 'Assertion failed')
  }

  clear() {}
  count(label = 'default') { const value = (this._times.get(`count:${label}`) ?? 0) + 1; this._times.set(`count:${label}`, value); this.log(`${label}: ${value}`) }
  countReset(label = 'default') { this._times.delete(`count:${label}`) }
  debug(...args) { this._write(this._stdout, args) }
  dir(value, options?) { this._write(this._stdout, [value, options]) }
  dirxml(...args) { this.log(...args) }
  error(...args) { this._write(this._stderr, args) }
  group(...args) {
    if (args.length)
      this.log(...args); this._groupIndent += '  '
  }

  groupCollapsed(...args) { this.group(...args) }
  groupEnd() { this._groupIndent = this._groupIndent.slice(0, -2) }
  info(...args) { this._write(this._stdout, args) }
  log(...args) { this._write(this._stdout, args) }
  table(value) { this.log(value) }
  time(label = 'default') { this._times.set(label, performance.now()) }
  timeEnd(label = 'default') { this.timeLog(label); this._times.delete(label) }
  timeLog(label = 'default', ...args) {
    const start = this._times.get(label); if (start !== undefined)
      this.log(`${label}: ${(performance.now() - start).toFixed(3)}ms`, ...args)
  }

  trace(...args) { this.error(new Error((format as (...values: any[]) => string)(...args)).stack) }
  warn(...args) { this._write(this._stderr, args) }
}

export default globalThis.console
