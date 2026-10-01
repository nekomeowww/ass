import assert from 'node:assert/strict'
import consoleDefault, { Console } from 'node:console'
import * as constants from 'node:constants'
import { channel, hasSubscribers, subscribe, unsubscribe } from 'node:diagnostics_channel'
import domain, { Domain } from 'node:domain'
import EventEmitter from 'node:events'
import { performance, timerify } from 'node:perf_hooks'
import * as sys from 'node:sys'
import * as types from 'node:util/types'

assert.equal(consoleDefault, globalThis.console)
assert.equal(typeof Console, 'function')
assert.equal(constants.F_OK, 0)
assert.equal(constants.COPYFILE_EXCL, 1)

const messages = []
const subscriber = (message, name) => messages.push([message, name])
subscribe('ass:test', subscriber)
assert.equal(hasSubscribers('ass:test'), true)
assert.equal(channel('ass:test').publish(42), undefined)
assert.deepEqual(messages, [[42, 'ass:test']])
assert.equal(unsubscribe('ass:test', subscriber), true)

const createdDomain = domain.create()
assert.equal(createdDomain instanceof Domain, true)
assert.equal(createdDomain instanceof EventEmitter, true)
assert.equal(createdDomain.bind(value => value + 1)(2), 3)

assert.equal(performance, globalThis.performance)
assert.equal(timerify(value => value * 2)(3), 6)
assert.equal(sys.format('%s:%d', 'value', 2), 'value:2')

assert.equal(types.isAnyArrayBuffer(new ArrayBuffer(1)), true)
assert.equal(types.isBoxedPrimitive(new Number(1)), true)
assert.equal(types.isGeneratorObject((function* () {})()), true)
assert.equal(types.isMapIterator(new Map().entries()), true)
assert.equal(types.isTypedArray(new Uint8Array()), true)
assert.equal(types.isTypedArray(new DataView(new ArrayBuffer(1))), false)

console.log('additional pure built-ins ok')
