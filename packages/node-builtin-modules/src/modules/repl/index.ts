import { Interface } from '@ass/node-builtin-modules/readline'
import { inspect } from '@ass/node-builtin-modules/util'

export const REPL_MODE_SLOPPY = Symbol('repl-sloppy')
export const REPL_MODE_STRICT = Symbol('repl-strict')
export const writer = value => inspect(value)
export const isValidSyntax = (code) => {
  // Syntax validation must compile without evaluating the supplied body.
  // eslint-disable-next-line no-new, no-new-func
  try { new Function(String(code)); return true }
  catch { return false }
}

export class Recoverable extends SyntaxError {
  err: Error
  constructor(error) { super(error.message); this.err = error }
}

export class REPLServer extends Interface {
  commands = Object.create(null)
  context = globalThis
  eval: any
  promptValue: string
  writer: any

  constructor(options: any = {}) {
    if (typeof options === 'string')
      options = { prompt: options }
    super({ input: options.input ?? globalThis.process.stdin, output: options.output ?? globalThis.process.stdout, terminal: options.terminal ?? false })
    this.promptValue = options.prompt ?? '> '
    this.writer = options.writer ?? writer
    this.eval = options.eval ?? ((code, _context, _filename, callback) => {
      try { callback(null, (0, eval)(code)) }
      catch (error) { callback(error) }
    })
    this.on('line', line => this._evaluate(line))
    queueMicrotask(() => this.displayPrompt())
  }

  _evaluate(line) {
    const command = this.commands[line.trim().split(/\s+/, 1)[0]?.replace(/^\./, '')]
    if (line.startsWith('.') && command) {
      command.action.call(this, line.slice(line.indexOf(' ') + 1))
      return
    }
    this.eval(line, this.context, 'repl', (error, value) => {
      if (error)
        this.output?.write(`${error.stack ?? error}\n`)
      else if (value !== undefined)
        this.output?.write(`${this.writer(value)}\n`)
      this.emit('result', error, value)
      this.displayPrompt()
    })
  }

  clearBufferedCommand() { this._lineBuffer = '' }
  defineCommand(keyword, action) { this.commands[keyword] = typeof action === 'function' ? { action } : action }
  displayPrompt() {
    if (!this.closed)
      this.output?.write(this.promptValue)
  }

  setupHistory(_path, callback) { queueMicrotask(() => callback(null, this)); return this }
}

export const start = options => new REPLServer(options)
export default { isValidSyntax, Recoverable, REPL_MODE_SLOPPY, REPL_MODE_STRICT, REPLServer, start, writer }
