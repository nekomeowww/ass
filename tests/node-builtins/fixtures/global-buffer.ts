import assert from 'node:assert/strict'

assert.equal(Buffer.from('global-buffer').toString(), 'global-buffer')
console.log('global Buffer ok')
