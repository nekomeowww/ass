import { Buffer } from '@ass/node-builtin-modules/buffer'

const chunks = async (stream) => {
  const output: any[] = []
  if (stream?.[Symbol.asyncIterator]) {
    for await (const chunk of stream)
      output.push(chunk)
    return output
  }
  const reader = stream.getReader()
  try {
    while (true) {
      const result = await reader.read()
      if (result.done)
        return output
      output.push(result.value)
    }
  }
  finally { reader.releaseLock() }
}

export const buffer = async stream => Buffer.concat((await chunks(stream)).map(chunk => Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
export const bytes = async stream => new Uint8Array(await buffer(stream))
export const arrayBuffer = async (stream) => { const value = await bytes(stream); return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) }
export const text = async stream => (await buffer(stream)).toString()
export const json = async stream => JSON.parse(await text(stream))
export const blob = async stream => new Blob(await chunks(stream))
export default { arrayBuffer, blob, buffer, bytes, json, text }
