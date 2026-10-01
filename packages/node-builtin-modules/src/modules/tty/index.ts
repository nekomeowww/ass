import { Readable, Writable } from '@ass/node-builtin-modules/stream'

const stdio = fd => fd === 0 ? globalThis.process.stdin : fd === 1 ? globalThis.process.stdout : fd === 2 ? globalThis.process.stderr : undefined

export const isatty = fd => Boolean(stdio(fd)?.isTTY)

export class ReadStream extends Readable {
  fd: number
  isRaw = false
  isTTY: boolean

  constructor(fd = 0, options: any = {}) {
    super(options)
    this.fd = fd
    this.isTTY = isatty(fd)
  }

  setRawMode(mode) { this.isRaw = Boolean(mode); return this }
}

export class WriteStream extends Writable {
  columns = 80
  fd: number
  isTTY: boolean
  rows = 24

  constructor(fd = 1) {
    const target = stdio(fd)
    super({ write: (chunk, encoding, callback) => target?.write(chunk, encoding, callback) ?? callback() })
    this.fd = fd
    this.isTTY = isatty(fd)
  }

  clearLine(direction, callback?) { const result = this.write(direction < 0 ? '\u001B[1K' : direction > 0 ? '\u001B[0K' : '\u001B[2K'); callback?.(); return result }
  clearScreenDown(callback?) { const result = this.write('\u001B[0J'); callback?.(); return result }
  cursorTo(x, y?, callback?) { if (typeof y === 'function') { callback = y; y = undefined }; const result = this.write(y === undefined ? `\u001B[${x + 1}G` : `\u001B[${y + 1};${x + 1}H`); callback?.(); return result }
  getColorDepth(environment = globalThis.process.env) {
    if (environment.FORCE_COLOR === '3')
      return 24; if (environment.FORCE_COLOR === '2')
      return 8; if (environment.FORCE_COLOR && environment.FORCE_COLOR !== '0')
      return 4; return this.isTTY ? 4 : 1
  }

  getWindowSize() { return [this.columns, this.rows] }
  hasColors(count = 16, environment?) { return count <= 2 ** this.getColorDepth(environment) }
  moveCursor(dx, dy, callback?) {
    let value = ''; if (dx < 0)
      value += `\u001B[${-dx}D`; if (dx > 0)
      value += `\u001B[${dx}C`; if (dy < 0)
      value += `\u001B[${-dy}A`; if (dy > 0)
      value += `\u001B[${dy}B`; const result = value ? this.write(value) : true; callback?.(); return result
  }
}

export default { isatty, ReadStream, WriteStream }
