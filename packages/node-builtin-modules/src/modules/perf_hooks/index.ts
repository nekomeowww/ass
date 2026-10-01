export const performance = globalThis.performance
export const Performance = globalThis.Performance
export const PerformanceEntry = globalThis.PerformanceEntry
export const PerformanceMark = globalThis.PerformanceMark
export const PerformanceMeasure = globalThis.PerformanceMeasure
export const PerformanceObserver = globalThis.PerformanceObserver
export const PerformanceObserverEntryList = globalThis.PerformanceObserverEntryList
export const PerformanceResourceTiming = globalThis.PerformanceResourceTiming

export const constants = {
  NODE_PERFORMANCE_GC_FLAGS_ALL_AVAILABLE_GARBAGE: 16,
  NODE_PERFORMANCE_GC_FLAGS_ALL_EXTERNAL_MEMORY: 32,
  NODE_PERFORMANCE_GC_FLAGS_CONSTRUCT_RETAINED: 2,
  NODE_PERFORMANCE_GC_FLAGS_FORCED: 4,
  NODE_PERFORMANCE_GC_FLAGS_NO: 0,
  NODE_PERFORMANCE_GC_FLAGS_SCHEDULE_IDLE: 64,
  NODE_PERFORMANCE_GC_FLAGS_SYNCHRONOUS_PHANTOM_PROCESSING: 8,
  NODE_PERFORMANCE_GC_FLAGS_SYNCHRONOUS_PHANTOM_PROCESSING_OLD: 8,
  NODE_PERFORMANCE_GC_MAJOR: 4,
  NODE_PERFORMANCE_GC_MINOR: 1,
  NODE_PERFORMANCE_GC_WEAKCB: 3,
}

class Histogram {
  enabled = false
  values: number[] = []
  get count() { return BigInt(this.values.length) }
  get exceeds() { return 0n }
  get max() { return BigInt(Math.round(Math.max(0, ...this.values))) }
  get mean() { return this.values.length ? this.values.reduce((sum, value) => sum + value, 0) / this.values.length : Number.NaN }
  get min() { return this.values.length ? BigInt(Math.round(Math.min(...this.values))) : 9223372036854775807n }
  get percentiles() { return new Map([[50, this.percentile(50)], [75, this.percentile(75)], [90, this.percentile(90)], [99, this.percentile(99)]]) }
  get stddev() { const mean = this.mean; return this.values.length ? Math.sqrt(this.values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / this.values.length) : Number.NaN }
  disable() { this.enabled = false; return true }
  enable() { this.enabled = true; return true }
  percentile(percentile) {
    if (!this.values.length)
      return 0n; const values = [...this.values].sort((a, b) => a - b); return BigInt(Math.round(values[Math.ceil(percentile / 100 * values.length) - 1]))
  }

  percentileBigInt(percentile) { return this.percentile(percentile) }
  record(value) { this.values.push(Number(value)) }
  recordDelta() { const now = performance.now() * 1e6; const previous = this.values.at(-1); this.values.push(now); return previous === undefined ? 0n : BigInt(Math.round(now - previous)) }
  reset() { this.values.length = 0 }
}

export const createHistogram = () => new Histogram()
export const monitorEventLoopDelay = () => new Histogram()
export const eventLoopUtilization = (first?, second?) => {
  if (first && second)
    return { active: first.active - second.active, idle: first.idle - second.idle, utilization: first.utilization - second.utilization }
  if (first)
    return { active: -first.active, idle: -first.idle, utilization: first.utilization ? -first.utilization : 0 }
  return { active: performance.now(), idle: 0, utilization: 1 }
}
export const timerify = function_ => function (...args) {
  const start = performance.now()
  try { return function_.apply(this, args) }
  finally { performance.measure?.(`timerified ${function_.name || '<anonymous>'}`, { duration: performance.now() - start, start }) }
}

export default { constants, createHistogram, eventLoopUtilization, monitorEventLoopDelay, Performance, performance, PerformanceEntry, PerformanceMark, PerformanceMeasure, PerformanceObserver, PerformanceObserverEntryList, PerformanceResourceTiming, timerify }
