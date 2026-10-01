/* eslint-disable perfectionist/sort-modules */
export interface ProcessSnapshot {
  arch: string
  argv: string[]
  argv0: string
  cwd: string
  env: Record<string, string>
  execPath: string
  gid: null | number
  groups: number[]
  pid: number
  platform: string
  ppid: number
  release: Record<string, string>
  stderrIsTTY: boolean
  stdinIsTTY: boolean
  stdoutIsTTY: boolean
  uid: null | number
  version: string
  versions: Record<string, string>
}

export interface AssProcess {
  [key: string]: unknown
  abort: () => never
  arch: string
  argv: string[]
  argv0: string
  chdir: (directory: string) => never
  cwd: () => string
  emit: (name: string | symbol, ...args: unknown[]) => boolean
  emitWarning: (warning: Error | string, type?: string) => void
  env: Record<string, string>
  execArgv: string[]
  execPath: string
  exit: (code?: number) => never
  exitCode?: number
  getgid?: () => number
  getgroups?: () => number[]
  getuid?: () => number
  hrtime: ((previous?: [number, number]) => [number, number]) & { bigint: () => bigint }
  nextTick: (callback: (...args: unknown[]) => void, ...args: unknown[]) => void
  off: (name: string | symbol, listener: (...args: unknown[]) => void) => AssProcess
  on: (name: string | symbol, listener: (...args: unknown[]) => void) => AssProcess
  once: (name: string | symbol, listener: (...args: unknown[]) => void) => AssProcess
  pid: number
  platform: string
  ppid: number
  release: Record<string, string>
  uptime: () => number
  version: string
  versions: Record<string, string>
}

export const createProcess = (
  snapshot: ProcessSnapshot,
  requestExit: (code: number) => void,
  writeOutput: (stream: 'stderr' | 'stdout', text: string) => void,
): AssProcess => {
  const startedAt = performance.now()
  const listeners = new Map<string | symbol, Array<(...args: unknown[]) => void>>()
  const unsupported = (name: string): never => {
    const error = new Error(
      `${name} is unavailable: ass cannot provide synchronous native mutations through a system WebView`,
    )
    Object.assign(error, { code: 'ERR_ASS_SYNC_UNSUPPORTED' })
    throw error
  }
  let processObject: AssProcess
  const on = (name: string | symbol, listener: (...args: unknown[]) => void): AssProcess => {
    listeners.set(name, [...(listeners.get(name) ?? []), listener])
    return processObject
  }
  const off = (name: string | symbol, listener: (...args: unknown[]) => void): AssProcess => {
    listeners.set(name, (listeners.get(name) ?? []).filter(value => value !== listener))
    return processObject
  }
  const emit = (name: string | symbol, ...args: unknown[]): boolean => {
    const registered = listeners.get(name) ?? []
    for (const listener of [...registered])
      listener(...args)
    return registered.length > 0
  }
  const once = (name: string | symbol, listener: (...args: unknown[]) => void): AssProcess => {
    const wrapped = (...args: unknown[]): void => {
      off(name, wrapped)
      listener(...args)
    }
    return on(name, wrapped)
  }
  const hrtime = ((previous?: [number, number]): [number, number] => {
    const nanoseconds = BigInt(Math.floor(performance.now() * 1_000_000))
    let seconds = Number(nanoseconds / 1_000_000_000n)
    let remainder = Number(nanoseconds % 1_000_000_000n)
    if (previous) {
      seconds -= previous[0]
      remainder -= previous[1]
      if (remainder < 0) {
        seconds--
        remainder += 1_000_000_000
      }
    }
    return [seconds, remainder]
  }) as AssProcess['hrtime']
  hrtime.bigint = () => BigInt(Math.floor(performance.now() * 1_000_000))

  processObject = {
    abort: () => {
      requestExit(134)
      throw new Error('process aborted')
    },
    allowedNodeEnvironmentFlags: new Set<string>(),
    arch: snapshot.arch,
    argv: [...snapshot.argv],
    argv0: snapshot.argv0,
    chdir: () => unsupported('process.chdir'),
    config: { target_defaults: {}, variables: {} },
    cwd: () => snapshot.cwd,
    emit,
    emitWarning: (warning, type = 'Warning') => {
      const message = warning instanceof Error ? warning.stack ?? warning.message : String(warning)
      console.warn(`${type}: ${message}`)
    },
    env: { ...snapshot.env },
    execArgv: [],
    execPath: snapshot.execPath,
    exit: (code = processObject.exitCode ?? 0) => {
      requestExit(Number(code) | 0)
      throw new Error('process exited')
    },
    features: {
      cached_builtins: false,
      debug: false,
      inspector: false,
      ipv6: true,
      require_module: false,
      tls: true,
      typescript: false,
      uv: false,
    },
    getgid: snapshot.gid === null ? undefined : () => snapshot.gid as number,
    getgroups: snapshot.gid === null ? undefined : () => [...snapshot.groups],
    getuid: snapshot.uid === null ? undefined : () => snapshot.uid as number,
    hrtime,
    nextTick: (callback, ...args) => {
      setTimeout(callback, 0, ...args)
    },
    off,
    on,
    once,
    pid: snapshot.pid,
    platform: snapshot.platform,
    ppid: snapshot.ppid,
    release: { ...snapshot.release },
    stderr: {
      fd: 2,
      isTTY: snapshot.stderrIsTTY,
      write: (value: unknown, _encoding?: unknown, callback?: () => void) => {
        writeOutput('stderr', String(value).replace(/\n$/, ''))
        callback?.()
        return true
      },
    },
    stdin: { fd: 0, isTTY: snapshot.stdinIsTTY },
    stdout: {
      fd: 1,
      isTTY: snapshot.stdoutIsTTY,
      write: (value: unknown, _encoding?: unknown, callback?: () => void) => {
        writeOutput('stdout', String(value).replace(/\n$/, ''))
        callback?.()
        return true
      },
    },
    title: 'ass',
    uptime: () => (performance.now() - startedAt) / 1000,
    version: snapshot.version,
    versions: { ...snapshot.versions },
  }
  Object.defineProperty(processObject, Symbol.toStringTag, { value: 'process' })
  return processObject
}
