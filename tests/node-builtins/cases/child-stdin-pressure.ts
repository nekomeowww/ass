import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'

const children = Array.from({ length: 20 }, () =>
  spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30_000)']))

await Promise.all(children.map(child => new Promise((resolve, reject) => {
  child.once('error', reject)
  child.once('spawn', resolve)
  child.stdin.on('error', () => {})
})))

const payload = Buffer.alloc(1024 * 1024, 0x61)
for (const child of children)
  child.stdin.write(payload, () => {})

await readFile('package.json')
console.log('fs-after-stdin-pressure')

for (const child of children)
  child.kill()
await Promise.all(children.map(child => new Promise(resolve => child.once('close', resolve))))
