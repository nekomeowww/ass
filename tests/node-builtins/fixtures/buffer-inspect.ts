import { Buffer } from 'node:buffer'

console.log(Buffer.from(Array.from({ length: 64 }, (_, index) => index)))
