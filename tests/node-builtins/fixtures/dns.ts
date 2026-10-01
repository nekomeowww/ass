import assert from 'node:assert/strict'
import { lookup } from 'node:dns'
import { lookup as lookupPromise } from 'node:dns/promises'

const callbackResult = await new Promise((resolve, reject) => lookup('localhost', { family: 4 }, (error, address, family) => error ? reject(error) : resolve({ address, family })))
assert.equal(callbackResult.family, 4)
assert.equal(typeof callbackResult.address, 'string')

const promiseResult = await lookupPromise('localhost', { all: true })
assert.equal(promiseResult.length > 0, true)
assert.equal(promiseResult.every(value => typeof value.address === 'string' && [4, 6].includes(value.family)), true)

console.log('dns lookup ok')
