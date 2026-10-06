import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'

// Pass a saved release binary to compare revisions without rebuilding between runs.
const binary = resolve(process.argv[2] ?? 'target/release/ass')
const directory = mkdtempSync(join(tmpdir(), 'ass-io-'))
const env = { ...process.env, TMPDIR: directory }
const path = join(directory, 'payload.bin')
const size = 8 * 1024 * 1024
writeFileSync(path, Buffer.alloc(size, 65))

function execute(args) {
  const result = spawnSync(binary, args, { env, encoding: 'utf8', timeout: 30_000 })
  assert.equal(result.error, undefined, result.error?.message)
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

const setup = `const fs=await import('node:fs/promises');`
const load = `${setup}const bytes=await fs.readFile(${JSON.stringify(path)});`
const cases = {
  'reuse-cli': null,
  'read-8MiB': `${setup}const t=performance.now();const bytes=await fs.readFile(${JSON.stringify(path)});const elapsed=performance.now()-t;if(bytes.length!==${size}||bytes[${size - 1}]!==65)throw Error('incorrect read');return elapsed;`,
  'decode-8MiB': `${load}const encoded=bytes.toString('base64');const t=performance.now();const decoded=Buffer.from(encoded,'base64');const elapsed=performance.now()-t;if(decoded.length!==bytes.length||decoded[${size - 1}]!==65)throw Error('incorrect decode');return elapsed;`,
  'encode-8MiB': `${load}const t=performance.now();const encoded=bytes.toString('base64');const elapsed=performance.now()-t;if(encoded.length!==${4 * Math.ceil(size / 3)})throw Error('incorrect encode');return elapsed;`,
}

try {
  const results = {}
  for (const [name, body] of Object.entries(cases)) {
    const times = []
    for (let index = 0; index < 23; index++) {
      const start = performance.now()
      const output = execute(['--reuse', '-p', body === null ? '42' : `(async()=>{${body}})()`])
      const elapsed = performance.now() - start
      if (body === null)
        assert.equal(output, '42')
      if (index >= 3)
        times.push(body === null ? elapsed : Number(output))
    }
    assert.ok(times.every(Number.isFinite))
    const sorted = [...times].sort((a, b) => a - b)
    results[name] = { unit: 'ms', samples: times, median: (sorted[9] + sorted[10]) / 2, p95: sorted[18] }
  }
  console.log(JSON.stringify({ binary, results }, null, 2))
}
finally {
  spawnSync(binary, ['daemon', 'stop'], { env, timeout: 5000, stdio: 'ignore' })
  rmSync(directory, { recursive: true, force: true })
}
