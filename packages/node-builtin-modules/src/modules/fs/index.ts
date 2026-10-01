import { callback, unsupportedSync } from '@ass/node-builtin-modules/internal/ops'

import * as promises from '@ass/node-builtin-modules/fs/promises'

export const constants = promises.constants
export const Stats = promises.Stats
export { promises }

const callbackMethod = (method: (...args: any[]) => Promise<any>, transform = (value: any): any => value) => (...args: any[]) => {
  const done = args.pop()
  if (typeof done !== 'function')
    throw new TypeError('The callback argument must be of type function')
  callback(method(...args), done, transform)
}

export const access = callbackMethod(promises.access)
export const appendFile = callbackMethod(promises.appendFile)
export const copyFile = callbackMethod(promises.copyFile)
export const lstat = callbackMethod(promises.lstat)
export const mkdir = callbackMethod(promises.mkdir)
export const readFile = callbackMethod(promises.readFile)
export const readdir = callbackMethod(promises.readdir)
export const realpath = callbackMethod(promises.realpath)
export const rename = callbackMethod(promises.rename)
export const rm = callbackMethod(promises.rm)
export const rmdir = callbackMethod(promises.rmdir)
export const stat = callbackMethod(promises.stat)
export const unlink = callbackMethod(promises.unlink)
export const writeFile = callbackMethod(promises.writeFile)
export const exists = (path, done) => promises.access(path).then(() => done(true), () => done(false))

export const accessSync = () => unsupportedSync('fs.accessSync')
export const appendFileSync = () => unsupportedSync('fs.appendFileSync')
export const copyFileSync = () => unsupportedSync('fs.copyFileSync')
export const existsSync = () => unsupportedSync('fs.existsSync')
export const lstatSync = () => unsupportedSync('fs.lstatSync')
export const mkdirSync = () => unsupportedSync('fs.mkdirSync')
export const readFileSync = () => unsupportedSync('fs.readFileSync')
export const readdirSync = () => unsupportedSync('fs.readdirSync')
export const realpathSync = () => unsupportedSync('fs.realpathSync')
export const renameSync = () => unsupportedSync('fs.renameSync')
export const rmSync = () => unsupportedSync('fs.rmSync')
export const rmdirSync = () => unsupportedSync('fs.rmdirSync')
export const statSync = () => unsupportedSync('fs.statSync')
export const unlinkSync = () => unsupportedSync('fs.unlinkSync')
export const writeFileSync = () => unsupportedSync('fs.writeFileSync')

export default { ...promises, access, accessSync, appendFile, appendFileSync, constants, copyFile, copyFileSync, exists, existsSync, lstat, lstatSync, mkdir, mkdirSync, promises, readdir, readdirSync, readFile, readFileSync, realpath, realpathSync, rename, renameSync, rm, rmdir, rmdirSync, rmSync, stat, Stats, statSync, unlink, unlinkSync, writeFile, writeFileSync }
