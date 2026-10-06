import assert from 'node:assert/strict'

import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ass = fileURLToPath(new URL('../../target/debug/ass', import.meta.url))
const fixture = fileURLToPath(new URL('./cases/server-liveness.ts', import.meta.url))
const child = spawn(ass, [fixture], {
  cwd: process.cwd(),
  env: { ...process.env, NODE_NO_WARNINGS: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let stdout = ''
let stderr = ''
child.stdout.setEncoding('utf8')
child.stderr.setEncoding('utf8')
child.stdout.on('data', chunk => stdout += chunk)
child.stderr.on('data', chunk => stderr += chunk)

const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
await Promise.race([
  new Promise<void>((resolve) => {
    const check = () => stdout.includes('listening') ? resolve() : setTimeout(check, 10)
    check()
  }),
  new Promise((_, reject) => setTimeout(() => reject(new Error(`server did not listen; stderr: ${stderr}`)), 5_000)),
])

await new Promise(resolve => setTimeout(resolve, 750))
assert.equal(child.exitCode, null, 'ass exited while a referenced server was still listening')
child.kill('SIGTERM')
await exited
console.log('ok referenced server liveness')

const unrefFixture = fileURLToPath(new URL('./cases/server-unref.ts', import.meta.url))
const unrefChild = spawn(ass, [unrefFixture], {
  cwd: process.cwd(),
  env: { ...process.env, NODE_NO_WARNINGS: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
const unrefResult = await Promise.race([
  new Promise(resolve => unrefChild.once('exit', (code, signal) => resolve({ code, signal }))),
  new Promise((_, reject) => setTimeout(() => reject(new Error('unref server kept ass alive')), 2_000)),
])
assert.deepEqual(unrefResult, { code: 0, signal: null })
console.log('ok unref server liveness')

interface CaseResult {
  code?: null | number
  signal?: NodeJS.Signals | null
  timeout?: true
}

const runCase = async (name: string, timeout = 4_000) => {
  const path = fileURLToPath(new URL(`./cases/${name}.ts`, import.meta.url))
  const process = spawn(ass, [path], {
    cwd: globalThis.process.cwd(),
    env: { ...globalThis.process.env, NODE_NO_WARNINGS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  process.stdout.setEncoding('utf8')
  process.stderr.setEncoding('utf8')
  process.stdout.on('data', chunk => stdout += chunk)
  process.stderr.on('data', chunk => stderr += chunk)
  const result = await Promise.race<CaseResult>([
    new Promise(resolve => process.once('exit', (code, signal) => resolve({ code, signal }))),
    new Promise(resolve => setTimeout(() => resolve({ timeout: true }), timeout)),
  ])
  if (result.timeout) {
    process.kill('SIGKILL')
    await new Promise(resolve => process.once('exit', resolve))
  }
  return { ...result, stderr, stdout }
}

const waitForText = async (read: () => string, expected: string, timeout = 5_000) => {
  const started = Date.now()
  while (!read().includes(expected)) {
    if (Date.now() - started >= timeout)
      throw new Error(`timed out waiting for ${JSON.stringify(expected)} in ${JSON.stringify(read())}`)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

const stdinPressure = await runCase('child-stdin-pressure')
assert.equal(stdinPressure.timeout, undefined, 'child stdin pressure starved fs')
assert.equal(stdinPressure.code, 0, stdinPressure.stderr)
assert.match(stdinPressure.stdout, /fs-after-stdin-pressure/)
console.log('ok child stdin pressure')

const chunks = await runCase('write-chunks')
assert.equal(chunks.code, 0, chunks.stderr)
assert.match(chunks.stdout, /bounded-native-write-chunks/)
console.log('ok bounded native write chunks')

const binaryLifecycle = await runCase('binary-lifecycle')
assert.equal(binaryLifecycle.code, 0, binaryLifecycle.stderr)
assert.match(binaryLifecycle.stdout, /one-use binary read token/)
console.log('ok binary read tokens cannot be replayed')

const uncaught = await runCase('uncaught-net-callback')
assert.equal(uncaught.timeout, undefined, 'uncaught server callback left ass running')
assert.equal(uncaught.code, 1)
assert.match(uncaught.stderr, /ReferenceError: net callback exploded/)
console.log('ok uncaught server callback')

const uncaughtTls = await runCase('uncaught-tls-callback')
assert.equal(uncaughtTls.timeout, undefined, 'uncaught TLS callback left ass running')
assert.equal(uncaughtTls.code, 1)
assert.match(uncaughtTls.stderr, /ReferenceError: tls callback exploded/)
console.log('ok uncaught TLS callback')

if (globalThis.process.platform !== 'win32') {
  const daemonDirectory = await mkdtemp(join(tmpdir(), 'ass-daemon-regression-'))
  const daemonEnvironment: NodeJS.ProcessEnv = {
    ...globalThis.process.env,
    NODE_NO_WARNINGS: '1',
    TMPDIR: daemonDirectory,
  }
  const runReused = (source: string) => spawnSync(ass, ['--reuse', '-e', source], {
    cwd: globalThis.process.cwd(),
    encoding: 'utf8',
    env: daemonEnvironment,
    timeout: 10_000,
  })
  try {
    const leaking = runReused(`
      import('node:net').then(net => new Promise(resolve => {
        const server = net.createServer()
        server.listen(0, '127.0.0.1', () => {
          console.log('daemon-listening', server.address().port)
          setTimeout(() => Promise.reject(new Error('daemon resource exploded')), 20)
          setTimeout(resolve, 1_000)
        })
      }))
    `)
    assert.equal(leaking.error, undefined, leaking.stderr)
    assert.equal(leaking.status, 1, leaking.stderr)
    const port = /daemon-listening (\d+)/.exec(leaking.stdout)?.[1]
    assert.ok(port, leaking.stdout)

    const rebound = runReused(`
      import('node:net').then(net => new Promise((resolve, reject) => {
        const server = net.createServer()
        server.once('error', reject)
        server.listen(${port}, '127.0.0.1', () => {
          server.close(() => {
            console.log('daemon-rebound')
            resolve()
          })
        })
      }))
    `)
    assert.equal(rebound.error, undefined, rebound.stderr)
    assert.equal(rebound.status, 0, rebound.stderr)
    assert.match(rebound.stdout, /daemon-rebound/)
    console.log('ok daemon releases an isolated realm after uncaught exception')

    // New clients may send their first request after accept(), in multiple writes.
    const socket = join(daemonDirectory, `ass-${globalThis.process.getuid!()}-${spawnSync(ass, ['--version'], { encoding: 'utf8' }).stdout.trim().split(' ').at(-1)}`, 'daemon.sock')
    await new Promise<void>((resolve, reject) => {
      const connection = createConnection(socket)
      let received = ''
      connection.setTimeout(3000, () => connection.destroy(new Error('delayed daemon request timed out')))
      connection.on('error', reject)
      connection.on('connect', () => {
        setTimeout(() => {
          connection.write('{"kind":')
          setTimeout(() => connection.write('"ping"}\n'), 30)
        }, 30)
      })
      connection.on('data', (data) => {
        received += data
        if (received.includes('\n')) {
          try { assert.equal(JSON.parse(received).kind, 'pong') }
          catch (error) { reject(error) }
          connection.end()
          resolve()
        }
      })
      connection.on('end', () => {
        if (!received.includes('\n'))
          reject(new Error('daemon closed a partial request'))
      })
    })
    console.log('ok daemon accepts delayed and fragmented requests')

    const binaryFixture = fileURLToPath(new URL('./fixtures/fs-binary.ts', import.meta.url))
    const binary = spawnSync(ass, ['--reuse', binaryFixture], { env: daemonEnvironment, encoding: 'utf8', timeout: 15_000 })
    assert.equal(binary.status, 0, binary.stderr)
    assert.match(binary.stdout, /binary file reads ok/)
    const detached = runReused(`import('node:fs/promises').then(fs => { fs.readFile('Cargo.toml', 'utf8').then(text => console.log(text.includes('name = "ass"'))) })`)
    assert.equal(detached.status, 0, detached.stderr)
    assert.equal(detached.stdout.trim(), 'true')
    console.log('ok daemon binary reads and detached completion')
  }
  finally {
    spawnSync(ass, ['daemon', 'stop'], { env: daemonEnvironment, timeout: 5_000 })
    await rm(daemonDirectory, { force: true, recursive: true })
  }

  if (globalThis.process.platform === 'darwin') {
    const expectSource = `
      set timeout 10
      spawn -noecho ${ass}
      expect "> "
      send "4+2\\033\\[D(\\033\\[C)\\r"
      expect {
        -re "\\r\\n6\\r\\n" {}
        eof { exit 12 }
        timeout { exit 13 }
      }
      expect "> "
      send "40 + 2\\r"
      expect {
        -re "\\r\\n42\\r\\n" {}
        eof { exit 14 }
        timeout { exit 15 }
      }
      expect "> "
      send "50 + 3\\r"
      expect {
        -re "\\r\\n53\\r\\n" {}
        eof { exit 18 }
        timeout { exit 19 }
      }
      expect "> "
      send "\\033\\[A\\033\\[A\\033\\[A\\033\\[B\\r"
      expect {
        -re "\\r\\n42\\r\\n" {}
        eof { exit 16 }
        timeout { exit 17 }
      }
      expect "> "
      send {import('node:net').then(net => { globalThis.replServer = net.createServer().listen(0); return ['server', 'open'].join('-') })\r}
      expect {
        "server-open" {}
        eof { exit 6 }
        timeout { exit 7 }
      }
      expect "> "
      send {const activeMessage = ['repl', 'active', 'exploded'].join(' '); setTimeout(() => Promise.reject(new ReferenceError(activeMessage)), 20); new Promise(resolve => setTimeout(() => resolve('late'), 100))\r}
      expect {
        "ReferenceError: repl active exploded" {}
        eof { exit 8 }
        timeout { exit 9 }
      }
      expect "> "
      send {globalThis.__assNativeCall('resource.hasReferenced').then(state => state.referenced)\r}
      expect {
        "true" {}
        eof { exit 10 }
        timeout { exit 11 }
      }
      send {const delayedMessage = ['repl', 'async', 'exploded'].join(' '); setTimeout(() => Promise.reject(new ReferenceError(delayedMessage)), 20); 'scheduled'\r}
      expect {
        "ReferenceError: repl async exploded" {}
        eof { exit 2 }
        timeout { exit 3 }
      }
      send "40 + 2\\r"
      expect {
        "42" {}
        eof { exit 4 }
        timeout { exit 5 }
      }
      send {globalThis.replServer.close(); 'server-closed'\r}
      expect "server-closed"
      send ".exit\\r"
      expect eof
      exit [lindex [wait] 3]
    `
    const repl = spawn('/usr/bin/expect', ['-c', expectSource], { cwd: globalThis.process.cwd() })
    let replOutput = ''
    repl.stdout.setEncoding('utf8')
    repl.stderr.setEncoding('utf8')
    repl.stdout.on('data', chunk => replOutput += chunk)
    repl.stderr.on('data', chunk => replOutput += chunk)
    const replExit = await new Promise(resolve => repl.once('exit', code => resolve(code)))
    assert.equal(replExit, 0, replOutput)
    console.log('ok REPL direction-key editing and history')
    assert.match(replOutput, /ReferenceError: repl async exploded/)
    assert.match(replOutput, /42/)
  }
  else {
    const repl = spawn('/usr/bin/script', ['-q', '-c', ass, '/dev/null'], { cwd: globalThis.process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] })
    let replOutput = ''
    repl.stdout.setEncoding('utf8')
    repl.stderr.setEncoding('utf8')
    repl.stdout.on('data', chunk => replOutput += chunk)
    repl.stderr.on('data', chunk => replOutput += chunk)
    await waitForText(() => replOutput, '> ')
    repl.stdin.write("import('node:net').then(net => { globalThis.replServer = net.createServer().listen(0); return ['server', 'open'].join('-') })\n")
    await waitForText(() => replOutput, 'server-open')
    await waitForText(() => replOutput.slice(replOutput.indexOf('server-open')), '> ')
    repl.stdin.write("const activeMessage = ['repl', 'active', 'exploded'].join(' '); setTimeout(() => Promise.reject(new ReferenceError(activeMessage)), 20); new Promise(resolve => setTimeout(() => resolve('late'), 100))\n")
    await waitForText(() => replOutput, 'ReferenceError: repl active exploded')
    await waitForText(() => replOutput.slice(replOutput.indexOf('ReferenceError: repl active exploded')), '> ')
    repl.stdin.write("globalThis.__assNativeCall('resource.hasReferenced').then(state => state.referenced)\n")
    await waitForText(() => replOutput.slice(replOutput.indexOf('ReferenceError: repl active exploded')), 'true')
    repl.stdin.write("const delayedMessage = ['repl', 'async', 'exploded'].join(' '); setTimeout(() => Promise.reject(new ReferenceError(delayedMessage)), 20); 'scheduled'\n")
    await waitForText(() => replOutput, 'ReferenceError: repl async exploded')
    await new Promise(resolve => setTimeout(resolve, 100))
    assert.equal(repl.exitCode, null, 'REPL exited after an idle uncaught exception')
    repl.stdin.write("40 + 2\nglobalThis.replServer.close(); 'server-closed'\n.exit\n")
    const replExit = await new Promise(resolve => repl.once('exit', code => resolve(code)))
    assert.equal(replExit, 0)
    assert.match(replOutput, /42/)
  }
  console.log('ok REPL server liveness and uncaught exception isolation')
}
