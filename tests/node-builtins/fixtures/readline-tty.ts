import assert from 'node:assert/strict'
import { createInterface } from 'node:readline'
import { Readable, Writable } from 'node:stream'
import tty, { ReadStream, WriteStream, isatty } from 'node:tty'

const lines = []
const interface_ = createInterface({ input: Readable.from(['one\ntwo\n']), terminal: false })
interface_.on('line', line => lines.push(line))
await new Promise(resolve => interface_.once('close', resolve))
assert.deepEqual(lines, ['one', 'two'])

let output = ''
const writable = new Writable({ write(chunk, _encoding, callback) { output += String(chunk); callback() } })
const questionInterface = createInterface({ input: Readable.from(['answer\n']), output: writable, terminal: false })
const answer = await new Promise(resolve => questionInterface.question('question? ', resolve))
assert.equal(answer, 'answer')
assert.equal(output, 'question? ')

assert.equal(tty.isatty, isatty)
assert.equal(typeof isatty(1), 'boolean')
assert.equal(typeof ReadStream, 'function')
assert.equal(typeof WriteStream, 'function')
if (isatty(0))
  assert.equal(new ReadStream(0).fd, 0)
if (isatty(1))
  assert.equal(new WriteStream(1).fd, 1)

console.log('readline and tty ok')
