import { Buffer } from '@ass/node-builtin-modules/buffer'
import { Transform } from '@ass/node-builtin-modules/stream'

const unsupported = (name) => {
  const error = new Error(`${name} is unavailable: the system WebView codec does not expose this operation`)
  throw Object.assign(error, { code: 'ERR_ASS_UNSUPPORTED' })
}
const codec = async (format, decompress, input) => {
  const constructor = decompress ? DecompressionStream : CompressionStream
  const stream = new Blob([Buffer.from(input)]).stream().pipeThrough(new constructor(format))
  return Buffer.from(await new Response(stream).arrayBuffer())
}
const callbackCodec = (format, decompress) => (input, options?, callback?) => {
  if (typeof options === 'function') { callback = options; options = {} }
  codec(format, decompress, input).then(value => callback(null, value), callback)
}
const unsupportedSync = name => () => unsupported(name)

class CodecTransform extends Transform {
  chunks: any[] = []
  constructor(format, decompress, options: any = {}) {
    super(options)
    this._writeImplementation = (chunk, _encoding, callback) => { this.chunks.push(Buffer.from(chunk)); callback() }
    this._finalImplementation = callback => codec(format, decompress, Buffer.concat(this.chunks)).then((output) => { this.push(output); callback() }, callback)
  }
}

export class BrotliCompress { constructor(_options?) { unsupported('zlib.BrotliCompress') } }
export class BrotliDecompress { constructor(_options?) { unsupported('zlib.BrotliDecompress') } }
export class Deflate extends CodecTransform { constructor(options?) { super('deflate', false, options) } }
export class DeflateRaw extends CodecTransform { constructor(options?) { super('deflate-raw', false, options) } }
export class Gunzip extends CodecTransform { constructor(options?) { super('gzip', true, options) } }
export class Gzip extends CodecTransform { constructor(options?) { super('gzip', false, options) } }
export class Inflate extends CodecTransform { constructor(options?) { super('deflate', true, options) } }

export class InflateRaw extends CodecTransform { constructor(options?) { super('deflate-raw', true, options) } }
export class Unzip extends CodecTransform {
  constructor(options?) {
    super('gzip', true, options)
    this._finalImplementation = (callback) => {
      const input = Buffer.concat(this.chunks)
      const format = input[0] === 0x1F && input[1] === 0x8B ? 'gzip' : 'deflate'
      codec(format, true, input).then((output) => { this.push(output); callback() }, callback)
    }
  }
}
export class ZstdCompress { constructor(_options?) { unsupported('zlib.ZstdCompress') } }
export class ZstdDecompress { constructor(_options?) { unsupported('zlib.ZstdDecompress') } }

export const gzip = callbackCodec('gzip', false)
export const gunzip = callbackCodec('gzip', true)
export const deflate = callbackCodec('deflate', false)
export const inflate = callbackCodec('deflate', true)
export const deflateRaw = callbackCodec('deflate-raw', false)
export const inflateRaw = callbackCodec('deflate-raw', true)
export const unzip = (input, options?, callback?) => {
  if (typeof options === 'function') { callback = options; options = {} }
  const value = Buffer.from(input); const format = value[0] === 0x1F && value[1] === 0x8B ? 'gzip' : 'deflate'
  codec(format, true, value).then(output => callback(null, output), callback)
}
export const gzipSync = unsupportedSync('zlib.gzipSync')
export const gunzipSync = unsupportedSync('zlib.gunzipSync')
export const deflateSync = unsupportedSync('zlib.deflateSync')
export const inflateSync = unsupportedSync('zlib.inflateSync')
export const deflateRawSync = unsupportedSync('zlib.deflateRawSync')
export const inflateRawSync = unsupportedSync('zlib.inflateRawSync')
export const unzipSync = unsupportedSync('zlib.unzipSync')
export const brotliCompress = (..._args) => unsupported('zlib.brotliCompress')
export const brotliDecompress = (..._args) => unsupported('zlib.brotliDecompress')
export const brotliCompressSync = unsupportedSync('zlib.brotliCompressSync')
export const brotliDecompressSync = unsupportedSync('zlib.brotliDecompressSync')
export const zstdCompress = (..._args) => unsupported('zlib.zstdCompress')
export const zstdDecompress = (..._args) => unsupported('zlib.zstdDecompress')
export const zstdCompressSync = unsupportedSync('zlib.zstdCompressSync')
export const zstdDecompressSync = unsupportedSync('zlib.zstdDecompressSync')

export const createGzip = options => new Gzip(options)
export const createGunzip = options => new Gunzip(options)
export const createDeflate = options => new Deflate(options)
export const createInflate = options => new Inflate(options)
export const createDeflateRaw = options => new DeflateRaw(options)
export const createInflateRaw = options => new InflateRaw(options)
export const createUnzip = options => new Unzip(options)
export const createBrotliCompress = options => new BrotliCompress(options)
export const createBrotliDecompress = options => new BrotliDecompress(options)
export const createZstdCompress = options => new ZstdCompress(options)
export const createZstdDecompress = options => new ZstdDecompress(options)

export const crc32 = (data, value = 0) => {
  let crc = (Number(value) ^ 0xFFFFFFFF) >>> 0
  for (const byte of Buffer.from(data)) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0)
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}
export const constants = { BROTLI_OPERATION_FINISH: 2, BROTLI_OPERATION_FLUSH: 1, DEFLATE: 1, DEFLATERAW: 5, GUNZIP: 4, GZIP: 3, INFLATE: 2, INFLATERAW: 6, UNZIP: 7, Z_DEFAULT_COMPRESSION: -1, Z_DEFAULT_STRATEGY: 0, Z_FINISH: 4, Z_NO_FLUSH: 0, Z_OK: 0, Z_SYNC_FLUSH: 2 }
export const codes = { Z_BUF_ERROR: -5, Z_DATA_ERROR: -3, Z_ERRNO: -1, Z_MEM_ERROR: -4, Z_NEED_DICT: 2, Z_OK: 0, Z_STREAM_END: 1, Z_STREAM_ERROR: -2, Z_VERSION_ERROR: -6 }

export default { BrotliCompress, brotliCompress, brotliCompressSync, BrotliDecompress, brotliDecompress, brotliDecompressSync, codes, constants, crc32, createBrotliCompress, createBrotliDecompress, createDeflate, createDeflateRaw, createGunzip, createGzip, createInflate, createInflateRaw, createUnzip, createZstdCompress, createZstdDecompress, Deflate, deflate, DeflateRaw, deflateRaw, deflateRawSync, deflateSync, Gunzip, gunzip, gunzipSync, Gzip, gzip, gzipSync, Inflate, inflate, InflateRaw, inflateRaw, inflateRawSync, inflateSync, Unzip, unzip, unzipSync, ZstdCompress, zstdCompress, zstdCompressSync, ZstdDecompress, zstdDecompress, zstdDecompressSync }
