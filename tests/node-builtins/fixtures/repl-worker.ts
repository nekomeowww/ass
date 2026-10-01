import assert from 'node:assert/strict'
import { isValidSyntax, start } from 'node:repl'
import { Readable, Writable } from 'node:stream'
import { MessageChannel, getEnvironmentData, isMainThread, setEnvironmentData, threadId } from 'node:worker_threads'

assert.equal(isValidSyntax('1 + 1'), true)
assert.equal(isValidSyntax('const ='), false)
let output = ''
const repl = start({ input: Readable.from(['1 + 1\n']), output: new Writable({ write(chunk, _encoding, callback) { output += String(chunk); callback() } }), prompt: '', terminal: false })
await new Promise(resolve => repl.once('close', resolve))
assert.equal(output.includes('2'), true)

assert.equal(isMainThread, true)
assert.equal(threadId, 0)
setEnvironmentData('answer', 42)
assert.equal(getEnvironmentData('answer'), 42)
const { port1, port2 } = new MessageChannel()
const message = new Promise(resolve => port1.onmessage = event => resolve(event.data))
port2.postMessage('channel')
assert.equal(await message, 'channel')
port1.close()
port2.close()

console.log('repl and worker metadata ok')
