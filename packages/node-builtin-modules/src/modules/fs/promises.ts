import { Buffer } from '@ass/node-builtin-modules/buffer'
import { bytesToBase64, op } from '@ass/node-builtin-modules/internal/ops'

const encodingOf = options => typeof options === 'string' ? options : options?.encoding
const pathValue = path => path instanceof URL ? path.pathname : String(path)

export class Stats {
  declare atime: Date
  declare birthtime: Date
  declare ctime: Date
  declare isDirectoryValue: boolean
  declare isFileValue: boolean
  declare isSymbolicLinkValue: boolean
  declare mtime: Date

  constructor(value: any) {
    const { isDirectory, isFile, isSymbolicLink, ...metadata } = value
    Object.assign(this, metadata)
    this.isDirectoryValue = isDirectory
    this.isFileValue = isFile
    this.isSymbolicLinkValue = isSymbolicLink
    this.atime = new Date(value.atimeMs)
    this.birthtime = new Date(value.birthtimeMs)
    this.ctime = new Date(value.ctimeMs ?? value.mtimeMs)
    this.mtime = new Date(value.mtimeMs)
  }

  isBlockDevice() { return false }
  isCharacterDevice() { return false }
  isDirectory() { return this.isDirectoryValue }
  isFIFO() { return false }
  isFile() { return this.isFileValue }
  isSocket() { return false }
  isSymbolicLink() { return this.isSymbolicLinkValue }
}

const asStats = value => new Stats(value)

export const readFile = async (path, options) => {
  const result = await op<ArrayBuffer>('fs.readFileBytes', { path: pathValue(path) })
  const bytes = Buffer.from(result)
  const encoding = encodingOf(options)
  return encoding ? bytes.toString(encoding) : bytes
}

export const writeFile = async (path, data, options: any = {}) => {
  const encoding = encodingOf(options) ?? 'utf8'
  const bytes = typeof data === 'string' ? Buffer.from(data, encoding) : Buffer.from(data)
  await op('fs.writeFile', { append: options?.flag?.startsWith('a') ?? false, data: bytesToBase64(bytes), path: pathValue(path) })
}

export const appendFile = async (path, data, options = {}) => writeFile(path, data, { ...options, flag: 'a' })
export const readdir = async (path, options) => {
  const entries = await op('fs.readdir', { path: pathValue(path) })
  if (options?.withFileTypes)
    return entries.map(name => ({ isBlockDevice: () => false, isCharacterDevice: () => false, isDirectory: () => false, isFIFO: () => false, isFile: () => false, isSocket: () => false, isSymbolicLink: () => false, name, parentPath: pathValue(path), path: pathValue(path) }))
  if (encodingOf(options) === 'buffer')
    return entries.map(name => Buffer.from(name))
  return entries
}
export const stat = async path => asStats(await op('fs.stat', { path: pathValue(path) }))
export const lstat = async path => asStats(await op('fs.lstat', { path: pathValue(path) }))
export const mkdir = async (path, options: any = {}) => op('fs.mkdir', { path: pathValue(path), recursive: options?.recursive ?? false })
export const rm = async (path, options: any = {}) => op('fs.rm', { force: options?.force ?? false, path: pathValue(path), recursive: options?.recursive ?? false })
export const rmdir = rm
export const unlink = async path => op('fs.unlink', { path: pathValue(path) })
export const rename = async (from, to) => op('fs.rename', { from: pathValue(from), to: pathValue(to) })
export const copyFile = async (from, to) => op('fs.copyFile', { from: pathValue(from), to: pathValue(to) })
export const access = async path => op('fs.access', { path: pathValue(path) })
export const realpath = async (path, options) => {
  const value = await op('fs.realpath', { path: pathValue(path) })
  return encodingOf(options) === 'buffer' ? Buffer.from(value) : value
}
export const constants = { COPYFILE_EXCL: 1, F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 }
export default { access, appendFile, constants, copyFile, lstat, mkdir, readdir, readFile, realpath, rename, rm, rmdir, stat, unlink, writeFile }
