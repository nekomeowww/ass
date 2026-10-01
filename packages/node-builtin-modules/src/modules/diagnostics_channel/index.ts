const channels = new Map<any, Channel>()

export class Channel {
  name: any
  stores = new Map<any, (context: any) => any>()
  subscribers = new Set<(...args: any[]) => void>()

  get hasSubscribers() { return this.subscribers.size > 0 }
  constructor(name) { this.name = name }
  bindStore(store, transform = value => value) { this.stores.set(store, transform); return this }
  publish(message) { for (const subscriber of [...this.subscribers]) subscriber(message, this.name) }
  runStores(context, function_, thisArgument?, ...args) {
    const entries = [...this.stores].map(([store, transform]) => [store, transform(context)])
    const run = index => index >= entries.length ? function_.apply(thisArgument, args) : entries[index][0].run(entries[index][1], () => run(index + 1))
    return run(0)
  }

  subscribe(subscriber) { this.subscribers.add(subscriber) }
  unbindStore(store) { return this.stores.delete(store) }
  unsubscribe(subscriber) { return this.subscribers.delete(subscriber) }
}

export const channel = (name) => {
  if (!channels.has(name))
    channels.set(name, new Channel(name))
  return channels.get(name)
}
export const hasSubscribers = name => channel(name).hasSubscribers
export const subscribe = (name, subscriber) => channel(name).subscribe(subscriber)
export const unsubscribe = (name, subscriber) => channel(name).unsubscribe(subscriber)

export const tracingChannel = (name) => {
  const trace = typeof name === 'object'
    ? name
    : {
        asyncEnd: channel(`tracing:${name}:asyncEnd`),
        asyncStart: channel(`tracing:${name}:asyncStart`),
        end: channel(`tracing:${name}:end`),
        error: channel(`tracing:${name}:error`),
        start: channel(`tracing:${name}:start`),
      }
  return {
    ...trace,
    get hasSubscribers() { return Object.values(trace).some((value: any) => value.hasSubscribers) },
    traceCallback(function_, position = -1, context: any = {}, thisArgument?, ...args) {
      trace.start.publish(context)
      const callbackIndex = position < 0 ? args.length + position : position
      const callback = args[callbackIndex]
      args[callbackIndex] = function (...values) {
        trace.asyncStart.publish(context)
        try { return callback.apply(this, values) }
        finally { trace.asyncEnd.publish(context) }
      }
      try { const value = function_.apply(thisArgument, args); trace.end.publish(context); return value }
      catch (error) { context.error = error; trace.error.publish(context); trace.end.publish(context); throw error }
    },
    tracePromise: async (function_, context: any = {}, thisArgument?, ...args) => {
      trace.start.publish(context)
      try { const value = await function_.apply(thisArgument, args); trace.asyncStart.publish(context); trace.asyncEnd.publish(context); return value }
      catch (error) { context.error = error; trace.error.publish(context); throw error }
      finally { trace.end.publish(context) }
    },
    traceSync(function_, context: any = {}, thisArgument?, ...args) {
      trace.start.publish(context)
      try { return function_.apply(thisArgument, args) }
      catch (error) { context.error = error; trace.error.publish(context); throw error }
      finally { trace.end.publish(context) }
    },
  }
}

export default { Channel, channel, hasSubscribers, subscribe, tracingChannel, unsubscribe }
