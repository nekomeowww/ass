import assert from 'node:assert/strict'
import { exec, execFile, spawn } from 'node:child_process'

const output = await new Promise((resolve, reject) => {
  exec('echo ass-native', (error, stdout) => error ? reject(error) : resolve(stdout.trim()))
})
assert.equal(output, 'ass-native')

const child = spawn(process.execPath, ['-e', "console.log('spawn-out'); console.error('spawn-error')"])
let stdout = ''
let stderr = ''
child.stdout.on('data', chunk => stdout += String(chunk))
child.stderr.on('data', chunk => stderr += String(chunk))
const code = await new Promise((resolve, reject) => {
  child.once('error', reject)
  child.once('close', resolve)
})
assert.equal(code, 0)
assert.equal(stdout.trim(), 'spawn-out')
assert.equal(stderr.trim(), 'spawn-error')

process.env.ASS_CHILD_ENV_TEST = 'updated'
const inheritedEnvironment = spawn(process.execPath, ['-e', 'console.log(process.env.ASS_CHILD_ENV_TEST)'])
let inheritedOutput = ''
inheritedEnvironment.stdout.on('data', chunk => inheritedOutput += String(chunk))
await new Promise((resolve, reject) => {
  inheritedEnvironment.once('error', reject)
  inheritedEnvironment.once('close', resolve)
})
assert.equal(inheritedOutput.trim(), 'updated')

const timedOut = await new Promise((resolve) => {
  execFile(process.execPath, ['-e', 'setTimeout(() => {}, 1000)'], { timeout: 10 }, error => resolve(error))
})
assert.ok(timedOut)
assert.equal(timedOut.code, null)
assert.equal(timedOut.killed, true)
assert.equal(timedOut.signal, 'SIGTERM')

const exceededBuffer = await new Promise((resolve) => {
  execFile(process.execPath, ['-e', 'process.stdout.write("123456789")'], { maxBuffer: 4 }, (error, bufferedStdout, bufferedStderr) => resolve({ bufferedStderr, bufferedStdout, error }))
})
assert.equal(exceededBuffer.error.code, 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
assert.equal(exceededBuffer.bufferedStdout, '1234')
assert.equal(exceededBuffer.bufferedStderr, '')

const echo = process.platform === 'win32'
  ? spawn(process.env.ComSpec, ['/d', '/s', '/c', 'more'])
  : spawn('/bin/cat')
let echoed = ''
echo.stdout.on('data', chunk => echoed += String(chunk))
echo.stdin.end('streamed-input')
const echoCode = await new Promise((resolve, reject) => {
  echo.once('error', reject)
  echo.once('close', resolve)
})
assert.equal(echoCode, 0)
assert.equal(echoed, 'streamed-input')
console.log('child process built-in ok')
