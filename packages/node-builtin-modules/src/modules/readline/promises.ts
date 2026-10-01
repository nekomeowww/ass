import { Interface as CallbackInterface, clearLine, clearScreenDown, cursorTo, moveCursor } from '@ass/node-builtin-modules/readline'

export class Interface extends CallbackInterface {
  question(query, options?) {
    return new Promise((resolve, reject) => {
      if (options?.signal?.aborted)
        reject(options.signal.reason); else super.question(query, options, resolve)
    })
  }
}

export class Readline {
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

export const createInterface = (...args) => new (Interface as any)(...args)
export default { clearLine, clearScreenDown, createInterface, cursorTo, Interface, moveCursor, Readline }
