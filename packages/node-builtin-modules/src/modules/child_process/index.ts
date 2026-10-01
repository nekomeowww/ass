import { Buffer } from '@ass/node-builtin-modules/buffer'
import { EventEmitter } from '@ass/node-builtin-modules/events'
import { bytesToBase64, op, setResourceReferenced, unsupportedSync } from '@ass/node-builtin-modules/internal/ops'
import { Readable, Writable } from '@ass/node-builtin-modules/stream'

const decode = (value, encoding) => encoding === 'buffer' || encoding === null ? Buffer.from(value, 'base64') : Buffer.from(value, 'base64').toString(encoding || 'utf8')

export const exec = (command, options, callback) => {
  if (typeof options === 'function') { callback = options; options = {} }
  options ||= {}
  const child = new EventEmitter() as EventEmitter & Record<string, any>
  child.pid = undefined
  child.connected = false
  child.killed = false
  child.kill = () => false
  child.ref = () => child
  child.unref = () => child
  const completion = op('child_process.exec', {
    command,
    cwd: options.cwd,
    env: options.env ?? globalThis.process.env,
    maxBuffer: options.maxBuffer,
    timeout: options.timeout,
  }).then((result) => {
    const stdout = decode(result.stdout, options.encoding)
    const stderr = decode(result.stderr, options.encoding)
    child.exitCode = result.code
    child.killed = Boolean(result.killed)
    child.signalCode = result.signal
    child.emit('exit', result.code, result.signal)
    child.emit('close', result.code, result.signal)
    if (!result.success) {
      const error = new Error(`Command failed: ${command}\n${stderr}`)
      Object.assign(error, { cmd: command, code: result.errorCode ?? result.code, killed: Boolean(result.killed), signal: result.signal, stderr, stdout })
      throw error
    }
    return { stderr, stdout }
  })
  if (callback)
    completion.then(({ stderr, stdout }) => callback(null, stdout, stderr), error => callback(error, error.stdout, error.stderr))
  child.completion = completion
  return child
}
export const execFile = (file, args, options, callback) => {
  if (!Array.isArray(args)) { callback = options; options = args; args = [] }
  if (typeof options === 'function') { callback = options; options = {} }
  const quote = value => `'${String(value).replace(/'/g, `'\\''`)}'`
  return exec([quote(file), ...args.map(quote)].join(' '), options, callback)
}
export const execSync = () => unsupportedSync('child_process.execSync')
export const execFileSync = () => unsupportedSync('child_process.execFileSync')
export const spawnSync = () => unsupportedSync('child_process.spawnSync')
const unsupported = (name) => { throw Object.assign(new Error(`${name} is not implemented by the ass child-process adapter`), { code: 'ERR_ASS_UNSUPPORTED' }) }

const stdioOptions = (value) => {
  if (Array.isArray(value))
    return [value[0] ?? 'pipe', value[1] ?? 'pipe', value[2] ?? 'pipe']
  const option = value ?? 'pipe'
  return [option, option, option]
}

export class ChildProcess extends EventEmitter {
  _referenced = true
  _resource?: number
  _spawnPromise?: Promise<any>
  _stdinWrites = Promise.resolve()
  connected = false
  exitCode: null | number = null
  killed = false
  pid?: number
  signalCode: null | string = null
  stderr: null | Readable = null
  stdin: null | Writable = null
  stdio: Array<null | Readable | Writable> = []
  stdout: null | Readable = null

  _readStream(name) {
    const stream = new Readable()
    const completion = this._spawnPromise.then(async () => {
      while (!stream.destroyed && this._resource) {
        const result: any = await op('child_process.read', { resource: this._resource, stream: name })
        if (result.pending) {
          await new Promise(resolve => setTimeout(resolve, 5))
          continue
        }
        if (result.eof) { stream.push(null); return }
        stream.push(Buffer.from(result.base64, 'base64'))
      }
    }).catch((error) => {
      if (this._resource)
        stream.destroy(error)
    })
    return { completion, stream }
  }

  _spawn(file, args, options) {
    if (options.shell)
      unsupported('child_process.spawn({ shell: true })')
    const [stdinOption, stdoutOption, stderrOption] = stdioOptions(options.stdio)
    this._spawnPromise = op('child_process.spawn', {
      args,
      cwd: options.cwd,
      env: options.env ?? globalThis.process.env,
      file,
      stderr: stderrOption,
      stdin: stdinOption,
      stdout: stdoutOption,
    }).then((info) => {
      this._resource = info.resource
      if (!this._referenced)
        setResourceReferenced(this._resource, false)
      this.pid = info.pid
      this.emit('spawn')
      return info
    })

    if (stdinOption === 'pipe') {
      this.stdin = new Writable({
        final: callback => this._stdinWrites.then(() => this._spawnPromise).then(async () => {
          let result: any
          do {
            result = await op('child_process.closeStdin', { resource: this._resource })
            if (result.pending)
              await new Promise(resolve => setTimeout(resolve, 5))
          } while (result.pending)
        }).then(() => callback(), callback),
        write: (chunk, encoding, callback) => {
          const bytes = typeof chunk === 'string' ? Buffer.from(chunk, encoding) : Buffer.from(chunk)
          this._stdinWrites = this._stdinWrites.then(() => this._spawnPromise).then(async () => {
            let offset = 0
            while (offset < bytes.length) {
              const end = Math.min(offset + 64 * 1024, bytes.length)
              const result: any = await op('child_process.write', { data: bytesToBase64(bytes.subarray(offset, end)), resource: this._resource })
              offset += result.bytesWritten ?? 0
              if (result.pending)
                await new Promise(resolve => setTimeout(resolve, 5))
            }
          })
          this._stdinWrites.then(() => callback(), callback)
        },
      })
    }
    const stdout = stdoutOption === 'pipe' ? this._readStream('stdout') : undefined
    const stderr = stderrOption === 'pipe' ? this._readStream('stderr') : undefined
    this.stdout = stdout?.stream ?? null
    this.stderr = stderr?.stream ?? null
    this.stdio = [this.stdin, this.stdout, this.stderr]

    this._spawnPromise.then(async () => {
      let result: any
      do {
        result = await op('child_process.wait', { resource: this._resource })
        if (result.pending)
          await new Promise(resolve => setTimeout(resolve, 10))
      } while (result.pending)
      this.exitCode = result.code
      this.emit('exit', result.code, null)
      await Promise.all([stdout?.completion, stderr?.completion])
      const resource = this._resource
      this._resource = undefined
      if (resource)
        await op('child_process.close', { resource })
      this.emit('close', result.code, null)
    }).catch((error) => {
      this.emit('error', error)
      this.emit('close', null, null)
    })
    options.signal?.addEventListener('abort', () => this.kill(), { once: true })
    return this
  }

  disconnect() { unsupported('child_process.ChildProcess.disconnect') }
  kill(_signal = 'SIGTERM') {
    if (!this._resource || this.exitCode !== null)
      return false
    this.killed = true
    void op('child_process.kill', { resource: this._resource }).catch(error => this.emit('error', error))
    return true
  }

  ref() { this._referenced = true; setResourceReferenced(this._resource, true); return this }
  send() { unsupported('child_process.ChildProcess.send') }
  unref() { this._referenced = false; setResourceReferenced(this._resource, false); return this }
}

export const spawn = (file, args?, options?: any) => {
  if (!Array.isArray(args)) { options = args ?? {}; args = [] }
  return new ChildProcess()._spawn(String(file), args.map(String), options ?? {})
}
export const fork = () => unsupported('child_process.fork')
export default { ChildProcess, exec, execFile, execFileSync, execSync, fork, spawn, spawnSync }
