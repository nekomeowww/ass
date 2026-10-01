import { Buffer } from '@ass/node-builtin-modules/buffer'

declare global {
  // eslint-disable-next-line vars-on-top
  var __assOsSnapshot: any
}

const snapshot = globalThis.__assOsSnapshot
const cloneCpu = cpu => ({ ...cpu, times: { ...cpu.times } })
const unsupportedSync = (name) => {
  const error = new Error(`${name} is unavailable: ass cannot mutate host scheduling state synchronously`)
  throw Object.assign(error, { code: 'ERR_ASS_SYNC_UNSUPPORTED' })
}

export const EOL = snapshot.platform === 'win32' ? '\r\n' : '\n'
export const devNull = snapshot.platform === 'win32' ? '\\\\.\\nul' : '/dev/null'
export const constants = {
  dlopen: {},
  errno: {},
  priority: { PRIORITY_ABOVE_NORMAL: -7, PRIORITY_BELOW_NORMAL: 10, PRIORITY_HIGH: -14, PRIORITY_HIGHEST: -20, PRIORITY_LOW: 19, PRIORITY_NORMAL: 0 },
  signals: {},
  UV_UDP_REUSEADDR: 4,
}
export const arch = () => snapshot.arch
export const availableParallelism = () => snapshot.cpus.length
export const cpus = () => snapshot.cpus.map(cloneCpu)
export const endianness = () => snapshot.endianness
export const freemem = () => snapshot.freeMem
export const getPriority = (pid = 0) => pid === 0 || pid === globalThis.process.pid ? snapshot.priority : unsupportedSync('os.getPriority')
export const homedir = () => snapshot.homeDir
export const hostname = () => snapshot.hostname
export const loadavg = () => [...snapshot.loadAverage]
export const machine = () => snapshot.machine
export const networkInterfaces = () => ({})
export const platform = () => snapshot.platform
export const release = () => snapshot.release
export const setPriority = () => unsupportedSync('os.setPriority')
export const tmpdir = () => snapshot.tempDir
export const totalmem = () => snapshot.totalMem
export const type = () => snapshot.typeName
export const uptime = () => snapshot.uptime
export const userInfo = (options: any = {}) => {
  const info = { ...snapshot.userInfo }
  if (options.encoding === 'buffer') {
    info.username = Buffer.from(info.username)
    info.homedir = Buffer.from(info.homedir)
    info.shell = Buffer.from(info.shell)
  }
  return info
}
export const version = () => snapshot.version

export default { arch, availableParallelism, constants, cpus, devNull, endianness, EOL, freemem, getPriority, homedir, hostname, loadavg, machine, networkInterfaces, platform, release, setPriority, tmpdir, totalmem, type, uptime, userInfo, version }
