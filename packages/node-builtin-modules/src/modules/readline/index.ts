import EventEmitter from '@ass/node-builtin-modules/events'

const write = (stream, value, callback?) => { const result = stream.write(value); callback?.(); return result }
export const clearLine = (stream, direction, callback?) => write(stream, direction < 0 ? '\u001B[1K' : direction > 0 ? '\u001B[0K' : '\u001B[2K', callback)
export const clearScreenDown = (stream, callback?) => write(stream, '\u001B[0J', callback)
export const cursorTo = (stream, x, y?, callback?) => {
  if (typeof y === 'function') { callback = y; y = undefined }
  return write(stream, y === undefined ? `\u001B[${x + 1}G` : `\u001B[${y + 1};${x + 1}H`, callback)
}
export const moveCursor = (stream, dx, dy, callback?) => {
  let value = ''
  if (dx < 0)
    value += `\u001B[${-dx}D`
  if (dx > 0)
    value += `\u001B[${dx}C`
  if (dy < 0)
    value += `\u001B[${-dy}A`
  if (dy > 0)
    value += `\u001B[${dy}B`
  return value ? write(stream, value, callback) : true
}

export class Interface extends EventEmitter {
  _lineBuffer = ''
  _prompt?: string
  _questionCallback?: (answer: string) => void
  closed = false
  input: any
  output: any
  terminal: boolean

  constructor(inputOrOptions, output?, completer?, terminal?) {
    super()
    const options = inputOrOptions?.input ? inputOrOptions : { completer, input: inputOrOptions, output, terminal }
    this.input = options.input
    this.output = options.output
    this.terminal = Boolean(options.terminal)
    this.input?.on?.('data', chunk => this._accept(String(chunk)))
    this.input?.once?.('end', () => {
      if (this._lineBuffer)
        this._emitLine(this._lineBuffer); this.close()
    })
  }

  _accept(value) {
    this._lineBuffer += value
    const lines = this._lineBuffer.split(/\r?\n/)
    this._lineBuffer = lines.pop() ?? ''
    for (const line of lines)
      this._emitLine(line)
  }

  _emitLine(line) {
    if (this._questionCallback) {
      const callback = this._questionCallback
      this._questionCallback = undefined
      callback(line)
    }
    else {
      this.emit('line', line)
    }
  }

  close() { if (!this.closed) { this.closed = true; this.emit('close') } }
  getPrompt() { return this._prompt ?? '> ' }
  pause() { this.input?.pause?.(); this.emit('pause'); return this }
  prompt() {
    if (this.output)
      this.output.write(this.getPrompt()); return this
  }

  question(query, options?, callback?) {
    if (typeof options === 'function') { callback = options; options = {} }
    this.output?.write(query)
    this._questionCallback = callback
  }

  resume() { this.input?.resume?.(); this.emit('resume'); return this }
  setPrompt(prompt) { this._prompt = prompt }
  write(data, key?) {
    if (key?.ctrl && key.name === 'c')
      this.close(); else this._accept(String(data ?? '')); return true
  }
}

export const createInterface = (...args) => new (Interface as any)(...args)
export const emitKeypressEvents = (stream, interface_) => {
  stream.on?.('data', value => interface_?.emit?.('keypress', String(value), { name: String(value), sequence: String(value) }))
}
class PromiseInterface extends Interface {
  question(query, options?) {
    return new Promise((resolve, reject) => {
      if (options?.signal?.aborted)
        reject(options.signal.reason); else super.question(query, options, resolve)
    })
  }
}
class PromiseReadline {
  autoCommit: boolean
  output: any
  pending = ''
  constructor(output, options: any = {}) { this.output = output; this.autoCommit = options.autoCommit ?? false }
  _append(value) {
    if (this.autoCommit)
      this.output.write(value); else this.pending += value; return this
  }

  clearLine(direction) { return this._append(direction < 0 ? '\u001B[1K' : direction > 0 ? '\u001B[0K' : '\u001B[2K') }
  clearScreenDown() { return this._append('\u001B[0J') }
  commit() { return new Promise((resolve, reject) => this.output.write(this.pending, (error) => { this.pending = ''; error ? reject(error) : resolve(undefined) })) }
  cursorTo(x, y?) { return this._append(y === undefined ? `\u001B[${x + 1}G` : `\u001B[${y + 1};${x + 1}H`) }
  moveCursor(dx, dy) { const output = { write: (value) => { this._append(value); return true } }; moveCursor(output, dx, dy); return this }
  rollback() { this.pending = ''; return Promise.resolve() }
}
export const promises = { createInterface: (...args) => new (PromiseInterface as any)(...args), Interface: PromiseInterface, Readline: PromiseReadline }
export default { clearLine, clearScreenDown, createInterface, cursorTo, emitKeypressEvents, Interface, moveCursor, promises }
