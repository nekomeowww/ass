const encoder = new TextEncoder()
const decoder = (encoding: string): TextDecoder => new TextDecoder(encoding === 'latin1' ? 'iso-8859-1' : encoding)

const decodeString = (value: string, encoding = 'utf8'): Uint8Array => {
  const normalized = String(encoding).toLowerCase().replace('-', '')
  if (normalized === 'hex') {
    const pairs = value.match(/[0-9a-f]{2}/gi) || []
    return Uint8Array.from(pairs, pair => Number.parseInt(pair, 16))
  }
  if (normalized === 'base64' || normalized === 'base64url') {
    let input = value.replace(/-/g, '+').replace(/_/g, '/')
    input += '='.repeat((4 - input.length % 4) % 4)
    return Uint8Array.from(atob(input), character => String(character).charCodeAt(0))
  }
  if (normalized === 'ascii' || normalized === 'latin1' || normalized === 'binary')
    return Uint8Array.from(value, character => character.charCodeAt(0) & 0xFF)
  if (normalized === 'utf16le' || normalized === 'ucs2') {
    const result = new Uint8Array(value.length * 2)
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index)
      result[index * 2] = code & 0xFF
      result[index * 2 + 1] = code >> 8
    }
    return result
  }
  return encoder.encode(value)
}

const Uint8ArrayBase = Uint8Array as unknown as new (...args: any[]) => Uint8Array<ArrayBuffer>

export class Buffer extends Uint8ArrayBase {
  static alloc(size: number, fill: any = 0, encoding?: string): Buffer {
    const result = new Buffer(size)
    if (fill !== 0)
      result.fill(typeof fill === 'string' ? Buffer.from(fill, encoding)[0] : fill)
    return result
  }

  static allocUnsafe(size: number) { return new Buffer(size) }
  static allocUnsafeSlow(size: number) { return new Buffer(size) }
  static byteLength(value: any, encoding?: string) { return Buffer.from(value, encoding).byteLength }
  static compare(a, b) {
    const length = Math.min(a.length, b.length)
    for (let index = 0; index < length; index++) {
      if (a[index] !== b[index])
        return a[index] < b[index] ? -1 : 1
    }
    return Math.sign(a.length - b.length)
  }

  static concat(values, totalLength = values.reduce((sum, value) => sum + value.length, 0)) {
    const result = Buffer.alloc(totalLength)
    let offset = 0
    for (const value of values) {
      const remaining = Math.max(0, totalLength - offset)
      result.set(value.subarray(0, remaining), offset)
      offset += Math.min(value.length, remaining)
    }
    return result
  }

  static from(value: any, encodingOrOffset?: any, length?: number): Buffer {
    if (typeof value === 'string')
      return new Buffer(decodeString(value, encodingOrOffset))
    if (value instanceof ArrayBuffer) {
      const offset = encodingOrOffset || 0
      return new Buffer(value, offset, length ?? value.byteLength - offset)
    }
    if (ArrayBuffer.isView(value))
      return new Buffer(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
    if (value && typeof value === 'object' && value.type === 'Buffer')
      return new Buffer(value.data)
    return new Buffer(value)
  }

  static isBuffer(value) { return value instanceof Buffer }
  static isEncoding(value) {
    return ['ascii', 'base64', 'base64url', 'binary', 'hex', 'latin1', 'ucs2', 'utf8', 'utf16le', 'utf-8'].includes(String(value).toLowerCase().replace('-', ''))
  }

  compare(target) { return Buffer.compare(this, target) }
  equals(other) { return Buffer.compare(this, other) === 0 }
  slice(start, end) {
    const view = super.slice(start, end)
    return Buffer.from(view)
  }

  subarray(start, end) {
    const view = super.subarray(start, end)
    return new Buffer(view.buffer, view.byteOffset, view.byteLength)
  }

  toJSON() { return { data: Array.from(this), type: 'Buffer' } }
  toString(encoding = 'utf8', start = 0, end = this.length) {
    const bytes = this.subarray(start, end)
    const normalized = String(encoding).toLowerCase().replace('-', '')
    if (normalized === 'hex')
      return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
    if (normalized === 'base64' || normalized === 'base64url') {
      const encoded = btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''))
      return normalized === 'base64url' ? encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : encoded
    }
    if (normalized === 'ascii' || normalized === 'latin1' || normalized === 'binary')
      return Array.from(bytes, byte => String.fromCharCode(normalized === 'ascii' ? byte & 0x7F : byte)).join('')
    if (normalized === 'utf16le' || normalized === 'ucs2') {
      let result = ''
      for (let index = 0; index + 1 < bytes.length; index += 2)
        result += String.fromCharCode(bytes[index] | bytes[index + 1] << 8)
      return result
    }
    return decoder('utf-8').decode(bytes)
  }

  write(value, offset = 0, length, encoding = 'utf8') {
    if (typeof length === 'string') { encoding = length; length = undefined }
    const bytes = Buffer.from(value, encoding)
    const written = Math.min(length ?? bytes.length, bytes.length, this.length - offset)
    this.set(bytes.subarray(0, written), offset)
    return written
  }
}

export const SlowBuffer = size => Buffer.alloc(size)
export const INSPECT_MAX_BYTES = 50
export const kMaxLength = 0x7FFFFFFF
export const constants = { MAX_LENGTH: kMaxLength, MAX_STRING_LENGTH: 0x1FFFFFE8 }
export const atob = globalThis.atob.bind(globalThis)
export const btoa = globalThis.btoa.bind(globalThis)
export const Blob = globalThis.Blob
export const File = globalThis.File
export const resolveObjectURL = id => id.startsWith('blob:') ? new URL(id) : undefined
export const transcode = async (source, fromEncoding, toEncoding) => Buffer.from(new TextDecoder(fromEncoding).decode(source), toEncoding)
export default { atob, btoa, Buffer, constants, kMaxLength, SlowBuffer, transcode }
