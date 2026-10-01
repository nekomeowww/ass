import { Buffer } from '@ass/node-builtin-modules/buffer'

export class StringDecoder {
  declare decoder: TextDecoder
  declare encoding: string

  constructor(encoding = 'utf8') {
    this.encoding = encoding
    this.decoder = new TextDecoder(encoding.replace('utf16le', 'utf-16le').replace('ucs2', 'utf-16le'), { fatal: false })
  }

  end(buffer) { return buffer ? this.decoder.decode(Buffer.from(buffer), { stream: false }) : this.decoder.decode() }
  write(buffer) { return this.decoder.decode(Buffer.from(buffer), { stream: true }) }
}
export default { StringDecoder }
