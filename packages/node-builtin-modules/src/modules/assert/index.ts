interface AssertionErrorOptions {
  actual?: unknown
  expected?: unknown
  message?: string
  operator?: string
}

const failAssertion = (message: string | undefined, actual: unknown, expected: unknown, operator = 'fail'): never => {
  throw new AssertionError({ actual, expected, message, operator })
}
export class AssertionError extends Error {
  declare actual: unknown
  declare code: string
  declare expected: unknown
  declare generatedMessage: boolean
  declare operator: string | undefined

  constructor(options: AssertionErrorOptions = {}) {
    super(options.message ?? `Expected values to satisfy ${options.operator ?? 'assertion'}`)
    this.name = 'AssertionError'
    this.code = 'ERR_ASSERTION'
    this.actual = options.actual
    this.expected = options.expected
    this.operator = options.operator
    this.generatedMessage = options.message === undefined
  }
}
const deepEqualValue = (a, b, strict, seen = new WeakMap()) => {
  if (strict ? Object.is(a, b) : a == b)
    return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object')
    return false
  if (strict && Object.getPrototypeOf(a) !== Object.getPrototypeOf(b))
    return false
  if (seen.get(a) === b)
    return true
  seen.set(a, b)
  const aKeys = Reflect.ownKeys(a).filter(key => Object.prototype.propertyIsEnumerable.call(a, key))
  const bKeys = Reflect.ownKeys(b).filter(key => Object.prototype.propertyIsEnumerable.call(b, key))
  return aKeys.length === bKeys.length && aKeys.every(key => bKeys.includes(key) && deepEqualValue(a[key], b[key], strict, seen))
}
const matchError = (error, expected) => {
  if (!expected)
    return true
  if (expected instanceof RegExp)
    return expected.test(error?.message ?? String(error))
  if (typeof expected === 'function')
    return error instanceof expected || expected(error) === true
  if (typeof expected === 'object')
    return Object.entries(expected).every(([key, value]) => deepEqualValue(error[key], value, true))
  return false
}
const assert = (value, message) => {
  if (!value)
    failAssertion(message, value, true, '==')
}
assert.AssertionError = AssertionError
assert.ok = assert
assert.fail = (message, actual, expected, operator) => failAssertion(message, actual, expected, operator)
assert.equal = (actual, expected, message) => {
  if (actual != expected)
    failAssertion(message, actual, expected, '==')
}
assert.notEqual = (actual, expected, message) => {
  if (actual == expected)
    failAssertion(message, actual, expected, '!=')
}
assert.strictEqual = (actual, expected, message) => {
  if (!Object.is(actual, expected))
    failAssertion(message, actual, expected, 'strictEqual')
}
assert.notStrictEqual = (actual, expected, message) => {
  if (Object.is(actual, expected))
    failAssertion(message, actual, expected, 'notStrictEqual')
}
assert.deepEqual = (actual, expected, message) => {
  if (!deepEqualValue(actual, expected, false))
    failAssertion(message, actual, expected, 'deepEqual')
}
assert.notDeepEqual = (actual, expected, message) => {
  if (deepEqualValue(actual, expected, false))
    failAssertion(message, actual, expected, 'notDeepEqual')
}
assert.deepStrictEqual = (actual, expected, message) => {
  if (!deepEqualValue(actual, expected, true))
    failAssertion(message, actual, expected, 'deepStrictEqual')
}
assert.notDeepStrictEqual = (actual, expected, message) => {
  if (deepEqualValue(actual, expected, true))
    failAssertion(message, actual, expected, 'notDeepStrictEqual')
}
assert.match = (value, regexp, message) => {
  if (!regexp.test(value))
    failAssertion(message, value, regexp, 'match')
}
assert.doesNotMatch = (value, regexp, message) => {
  if (regexp.test(value))
    failAssertion(message, value, regexp, 'doesNotMatch')
}
assert.throws = (block, expected, message) => {
  try { block() }
  catch (error) {
    if (matchError(error, expected))
      return error; throw error
  }
  failAssertion(message ?? 'Missing expected exception', undefined, expected, 'throws')
}
assert.doesNotThrow = (block, expected, message) => {
  try { block() }
  catch (error) {
    if (matchError(error, expected))
      failAssertion(message, error, expected, 'doesNotThrow'); throw error
  }
}
assert.rejects = async (block, expected, message) => {
  try { await (typeof block === 'function' ? block() : block) }
  catch (error) {
    if (matchError(error, expected))
      return error; throw error
  }
  failAssertion(message ?? 'Missing expected rejection', undefined, expected, 'rejects')
}
assert.doesNotReject = async (block, expected, message) => {
  try { await (typeof block === 'function' ? block() : block) }
  catch (error) {
    if (matchError(error, expected))
      failAssertion(message, error, expected, 'doesNotReject'); throw error
  }
}
assert.ifError = (value) => {
  if (value != null)
    throw value
}
assert.strict = assert
export const { deepEqual, deepStrictEqual, doesNotMatch, doesNotReject, doesNotThrow, equal, fail, ifError, match, notDeepEqual, notDeepStrictEqual, notEqual, notStrictEqual, ok, rejects, strictEqual, throws } = assert
export const strict = assert
export default assert
