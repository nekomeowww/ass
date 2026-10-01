import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'

const children = Array.from({ length: 9 }, () => process.platform === 'win32'
  ? spawn(process.env.ComSpec, ['/d', '/s', '/c', 'more'])
  : spawn('/bin/cat'))

await Promise.all(children.map(child => new Promise((resolve, reject) => {
  child.once('error', reject)
  child.once('spawn', resolve)
})))

const first = children[0]
const echoed = new Promise((resolve, reject) => {
  first.stdout.once('data', resolve)
  first.once('error', reject)
})
const deadline = setTimeout(() => process.exit(2), 1_500)
first.stdin.write('worker-pressure-ok')
const chunk = await echoed
clearTimeout(deadline)
assert.equal(String(chunk), 'worker-pressure-ok')

for (const child of children)
  child.stdin.end()
await Promise.all(children.map(child => new Promise(resolve => child.once('close', resolve))))

console.log('child process worker pressure ok')
