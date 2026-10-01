import { op } from '@ass/node-builtin-modules/internal/ops'

export const ADDRGETNETWORKPARAMS = 'EADDRGETNETWORKPARAMS'
export const BADFAMILY = 'EBADFAMILY'
export const BADFLAGS = 'EBADFLAGS'
export const BADHINTS = 'EBADHINTS'
export const BADNAME = 'EBADNAME'
export const BADQUERY = 'EBADQUERY'
export const BADRESP = 'EBADRESP'
export const BADSTR = 'EBADSTR'
export const CANCELLED = 'ECANCELLED'
export const CONNREFUSED = 'ECONNREFUSED'
export const DESTRUCTION = 'EDESTRUCTION'
export const EMPTY = 'EEMPTY'
export const EOF = 'EOF'
export const FILE = 'EFILE'
export const FORMERR = 'EFORMERR'
export const LOADIPHLPAPI = 'ELOADIPHLPAPI'
export const NODATA = 'ENODATA'
export const NOMEM = 'ENOMEM'
export const NONAME = 'ENONAME'
export const NOTFOUND = 'ENOTFOUND'
export const NOTIMP = 'ENOTIMP'
export const NOTINITIALIZED = 'ENOTINITIALIZED'
export const REFUSED = 'EREFUSED'
export const SERVFAIL = 'ESERVFAIL'
export const TIMEOUT = 'ETIMEOUT'

let defaultResultOrder = 'verbatim'
let servers: string[] = []
const unsupported = (name) => {
  const error = new Error(`${name} is not implemented by the ass system resolver adapter`)
  throw Object.assign(error, { code: 'ERR_ASS_UNSUPPORTED' })
}
const normalizeOptions = options => typeof options === 'number' ? { family: options } : options ?? {}
const orderAddresses = (addresses, order) => {
  if (order === 'ipv4first')
    return [...addresses].sort((a, b) => a.family - b.family)
  if (order === 'ipv6first')
    return [...addresses].sort((a, b) => b.family - a.family)
  return addresses
}

export const lookup = async (hostname, options?) => {
  options = normalizeOptions(options)
  const addresses: any[] = orderAddresses(await op('dns.lookup', { family: options.family ?? 0, hostname: String(hostname) }), options.order ?? (options.verbatim === false ? 'ipv4first' : defaultResultOrder))
  return options.all ? addresses : addresses[0]
}
export const lookupService = (address, port) => op('dns.lookupService', { address: String(address), port: Number(port) })
export const resolve4 = async (hostname, options: any = {}) => {
  const addresses: any[] = await op('dns.lookup', { family: 4, hostname: String(hostname) })
  return options.ttl ? addresses.map(({ address }) => ({ address, ttl: 0 })) : addresses.map(({ address }) => address)
}
export const resolve6 = async (hostname, options: any = {}) => {
  const addresses: any[] = await op('dns.lookup', { family: 6, hostname: String(hostname) })
  return options.ttl ? addresses.map(({ address }) => ({ address, ttl: 0 })) : addresses.map(({ address }) => address)
}
export const resolve = (hostname, recordType = 'A') => {
  if (recordType === 'A')
    return resolve4(hostname)
  if (recordType === 'AAAA')
    return resolve6(hostname)
  const error = new Error(`dns.resolve does not support ${recordType} records yet`)
  return Promise.reject(Object.assign(error, { code: 'ERR_ASS_UNSUPPORTED' }))
}
export const getDefaultResultOrder = () => defaultResultOrder
export const setDefaultResultOrder = (value) => { defaultResultOrder = value }
export const getServers = () => [...servers]
export const setServers = (value) => { servers = [...value] }

export class Resolver {
  getServers() { return getServers() }
  resolve(hostname, recordType?) { return resolve(hostname, recordType) }
  resolve4(hostname, options?) { return resolve4(hostname, options) }
  resolve6(hostname, options?) { return resolve6(hostname, options) }
  setLocalAddress(_ipv4?, _ipv6?) { return unsupported('dns.Resolver.setLocalAddress') }
  setServers(value) { setServers(value) }
}

export default { ADDRGETNETWORKPARAMS, BADFAMILY, BADFLAGS, BADHINTS, BADNAME, BADQUERY, BADRESP, BADSTR, CANCELLED, CONNREFUSED, DESTRUCTION, EMPTY, EOF, FILE, FORMERR, getDefaultResultOrder, getServers, LOADIPHLPAPI, lookup, lookupService, NODATA, NOMEM, NONAME, NOTFOUND, NOTIMP, NOTINITIALIZED, REFUSED, resolve, resolve4, resolve6, Resolver, SERVFAIL, setDefaultResultOrder, setServers, TIMEOUT }
