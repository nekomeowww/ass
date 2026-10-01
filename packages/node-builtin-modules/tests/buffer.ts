import assert from 'node:assert/strict'

import { Buffer } from '../dist/buffer.mjs'

const buffer = Buffer.from('a')

assert.equal(buffer.subarray(0, 1).toString(), 'a')
