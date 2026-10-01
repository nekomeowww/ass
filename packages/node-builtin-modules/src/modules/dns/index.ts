import * as promises from '@ass/node-builtin-modules/dns/promises'

export * from '@ass/node-builtin-modules/dns/promises'
export { promises }

const callback = (promise, done, spread = false) => promise.then(
  value => queueMicrotask(() => spread ? done(null, ...value) : done(null, value)),
  error => queueMicrotask(() => done(error)),
)
export const lookup = (hostname, options?, done?) => {
  if (typeof options === 'function') { done = options; options = {} }
  const all = typeof options === 'object' && options?.all
  return callback(promises.lookup(hostname, options).then(value => all ? value : [value.address, value.family]), done, !all)
}
export const lookupService = (address, port, done) => callback(promises.lookupService(address, port).then(value => [value.hostname, value.service]), done, true)
export const resolve4 = (hostname, options?, done?) => { if (typeof options === 'function') { done = options; options = {} }; return callback(promises.resolve4(hostname, options), done) }
export const resolve6 = (hostname, options?, done?) => { if (typeof options === 'function') { done = options; options = {} }; return callback(promises.resolve6(hostname, options), done) }
export const resolve = (hostname, recordType?, done?) => { if (typeof recordType === 'function') { done = recordType; recordType = 'A' }; return callback(promises.resolve(hostname, recordType), done) }

export class Resolver {
  implementation = new promises.Resolver()
  getServers() { return this.implementation.getServers() }
  resolve(hostname, recordType?, done?) { if (typeof recordType === 'function') { done = recordType; recordType = 'A' }; return callback(this.implementation.resolve(hostname, recordType), done) }
  resolve4(hostname, options?, done?) { if (typeof options === 'function') { done = options; options = {} }; return callback(this.implementation.resolve4(hostname, options), done) }
  resolve6(hostname, options?, done?) { if (typeof options === 'function') { done = options; options = {} }; return callback(this.implementation.resolve6(hostname, options), done) }
  setLocalAddress(ipv4?, ipv6?) { return this.implementation.setLocalAddress(ipv4, ipv6) }
  setServers(value) { return this.implementation.setServers(value) }
}

export default { ...promises, lookup, lookupService, promises, resolve, resolve4, resolve6, Resolver }
