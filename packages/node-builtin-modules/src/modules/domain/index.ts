import EventEmitter from '@ass/node-builtin-modules/events'

export const _stack: Domain[] = []
// Node exposes this as a live binding that changes while a domain is entered.
// eslint-disable-next-line import/no-mutable-exports
export let active: Domain | null = null

export class Domain extends EventEmitter {
  members = new Set<any>()

  add(emitter) { this.members.add(emitter); emitter.domain = this; return this }
  bind(callback) {
    const domain = this
    return function (...args) {
      try { return domain.run(callback, this, args) }
      catch (error) { domain.emit('error', error); return undefined }
    }
  }

  dispose() {
    this.exit(); for (const member of this.members) {
      if (member.domain === this)
        member.domain = null
    } this.members.clear(); this.removeAllListeners(undefined)
  }

  enter() { _stack.push(this); active = this; return this }
  exit() {
    const index = _stack.lastIndexOf(this)
    if (index >= 0)
      _stack.splice(index, 1)
    active = _stack.at(-1) ?? null
    return this
  }

  intercept(callback) {
    return this.bind(function (error, ...args) {
      if (error)
        throw error
      return callback.apply(this, args)
    })
  }

  remove(emitter) {
    this.members.delete(emitter); if (emitter.domain === this)
      emitter.domain = null; return this
  }

  run(callback, thisArgument?, args: any[] = []) {
    this.enter()
    try { return callback.apply(thisArgument, args) }
    finally { this.exit() }
  }
}

export const create = () => new Domain()
export const createDomain = create
export default { _stack, get active() { return active }, create, createDomain, Domain }
