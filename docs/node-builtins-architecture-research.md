# Node.js built-in modules in a Rust-hosted WebView

Status: design research, 2026-07-31

This note evaluates how `ass` should add broad `node:` built-in module support while preserving its defining constraint: JavaScript runs in the operating system WebView and the executable does not bundle a JavaScript engine.

## Recommendation

Use a three-layer design:

```text
node:* ESM facade in the WebView
        |
        | typed, versioned, asynchronous operations
        v
Rust capability services + resource table
        |
        v
filesystem / sockets / subprocesses / OS crypto
```

The division of responsibility should be:

1. Keep Node API shape and semantics in JavaScript: argument normalization, overloads, callbacks, errors, `EventEmitter`, streams, and named/default exports.
2. Keep pure computation and existing Web Platform functionality in the WebView.
3. Expose small, typed Rust primitives for privileged or persistent OS functionality.
4. Represent every long-lived native object with an opaque resource ID (`rid`) owned by an evaluation/realm.
5. Enforce filesystem, network, environment, and subprocess permissions in Rust, immediately before the OS action.

This is the same high-level split used by Deno: its Node compatibility package registers Rust operations and ships JavaScript polyfills/facades around them. Deno's extension declaration groups dependencies, operations, ESM, lazy ESM, and state initialization into one capability package ([Deno `extension!` source](https://github.com/denoland/deno/blob/131a72736f59fb00185b1974806f5ad8ede46717/libs/core/extensions.rs#L430-L475), [Deno Node extension](https://github.com/denoland/deno/blob/131a72736f59fb00185b1974806f5ad8ede46717/ext/node/lib.rs#L199-L520)).

Do **not** depend on `deno_node` or `deno_core`. They are useful reference implementations, but their native path is built around an embedded V8 isolate, direct ops/fast calls, CppGC objects, libuv compatibility, and other Deno extensions. Pulling that stack into `ass` would duplicate the JavaScript engine and defeat the system-WebView size model.

## Current `ass` boundary

At the time of this research, the relevant repository properties are:

- Wry embeds WKWebView on macOS, WebView2 on Windows, and WebKitGTK on Linux.
- Local modules are served through the `ass:` custom protocol.
- WebView-to-Rust control messages use `window.ipc.postMessage(JSON.stringify(...))`.
- Rust-to-WebView messages are injected with `WebView::evaluate_script`.
- A Promise-returning `nativeCall(method, args)` and isolated iframe forwarding path are being developed in `packages/bridge`.
- One-shot/daemon isolated execution uses a sandboxed iframe; the REPL intentionally uses a persistent realm.

That is already the right starting direction for asynchronous native operations, but it is not yet sufficient for Node compatibility. The protocol also needs resource lifetime, event delivery, cancellation, binary transfer, permissions, and event-loop liveness.

Wry's raw IPC callback accepts `Request<String>`; `window.ipc.postMessage(...)` is a one-way JS-to-host send, not a direct-return FFI call ([Wry `with_ipc_handler`](https://docs.rs/wry/0.56.0/wry/struct.WebViewBuilder.html#method.with_ipc_handler)). `evaluate_script` likewise schedules script execution and returns only whether submission succeeded; the callback variant serializes the JavaScript result to JSON and documents a Windows exception limitation ([Wry `WebView`](https://docs.rs/wry/0.56.0/wry/struct.WebView.html#method.evaluate_script_with_callback)). Consequently, the portable native call primitive in `ass` is a Promise.

## What to copy from Deno

### JavaScript facade over coarse Rust primitives

Deno documents operations as the RPC boundary between JavaScript and Rust for facilities such as filesystem, networking, and timers ([Deno op tracing documentation](https://docs.deno.com/runtime/fundamentals/debugging/#--strace-ops)). Its Node `fs` implementation has paired synchronous/asynchronous native operations, while the JavaScript facade restores Node's callback and public API behavior ([Deno Node `fs` ops](https://github.com/denoland/deno/blob/131a72736f59fb00185b1974806f5ad8ede46717/ext/node/ops/fs.rs#L306-L445), [`exists` facade](https://github.com/denoland/deno/blob/131a72736f59fb00185b1974806f5ad8ede46717/ext/node/polyfills/_fs/_fs_exists.ts#L22-L77)).

For `ass`, this means a facade should call operations such as:

```text
fs.open(path, flags, mode) -> rid
io.read(rid, offset, length) -> bytes
io.write(rid, offset, bytes) -> count
io.close(rid) -> void
net.connect(address) -> rid
net.listen(address) -> rid
process.spawn(spec) -> { childRid, stdinRid, stdoutRid, stderrRid }
```

Avoid a permanently untyped `nativeCall("fs.readFile", arbitraryJson)` dispatcher. The wire envelope may share a dispatcher, but each operation should have a Rust request/response type, validation, permission check, and stable error mapping. Prefer primitives that several facades can reuse (`io.read`, `io.close`) over mirroring every Node method in Rust.

### A resource table

Deno keeps heterogeneous native resources in a table keyed by a `u32` resource ID. It supports `add`, typed `get`, and `take`; the `Resource` abstraction supplies asynchronous and synchronous reads/writes, BYOB reads, shutdown, close, cancellation, and access to backing handles ([resource table](https://github.com/denoland/deno/blob/131a72736f59fb00185b1974806f5ad8ede46717/libs/core/io/resource_table.rs#L12-L146), [`Resource` trait](https://github.com/denoland/deno/blob/131a72736f59fb00185b1974806f5ad8ede46717/libs/core/io/resource.rs#L70-L215)).

`ass` should create one common table for:

- open files and directories;
- TCP/UDP sockets and listeners;
- HTTP bodies and servers;
- child processes and their stdio;
- filesystem watchers;
- compression/crypto streaming state;
- future workers or message ports.

A resource record should include at least:

```rust
struct ResourceEntry {
    owner: RealmId,
    referenced: bool,
    kind: ResourceKind,
    cancel: CancellationToken,
}
```

The table must reject cross-realm access. Destroying an isolated iframe, completing a daemon request, cancelling evaluation, or closing the WebView must close every resource owned by that realm. JavaScript finalizers may be an optimization, never the correctness mechanism.

The existing isolated-frame token must therefore become part of the native envelope. Wry warns that on Linux and Android the IPC request URL is unavailable for iframe requests and the main-frame URL is reported instead, so the host cannot safely infer the caller from the request URL ([Wry IPC platform note](https://docs.rs/wry/0.56.0/wry/struct.WebViewBuilder.html#method.with_ipc_handler)).

### Event-loop liveness

Node handles are not just objects; referenced handles keep the process alive, and `.unref()` reverses that behavior. Deno tracks unreferenced operations and resources in runtime state specifically for Node compatibility ([Deno `OpState`](https://github.com/denoland/deno/blob/131a72736f59fb00185b1974806f5ad8ede46717/libs/core/ops.rs#L219-L270)).

This is an architectural requirement for `net.Server`, `ChildProcess`, watchers, timers, and sockets. `ass` should not emit the final one-shot result and tear down the realm merely because the top-level Promise settled while referenced resources remain. It needs this rule:

```text
evaluation is complete = top-level settled
                         AND no referenced resources
                         AND no referenced native operations
                         AND no queued Node next-tick work
```

In isolated daemon execution, a request timeout/disconnect must cancel the entire realm and its resources. The persistent REPL may preserve its realm resources until explicit close or REPL exit.

### Lazy built-in loading

Deno makes all supported `node:` specifiers resolvable but lazily deserializes/executes their polyfills, then exposes them through synthetic ESM exports ([lazy sources](https://github.com/denoland/deno/blob/131a72736f59fb00185b1974806f5ad8ede46717/ext/node/lib.rs#L464-L520), [synthetic ESM loading](https://github.com/denoland/deno/blob/131a72736f59fb00185b1974806f5ad8ede46717/ext/node/lib.rs#L797-L836)).

`ass` should similarly keep a manifest:

```text
specifier -> embedded JS source -> export names -> required capabilities
```

Serve the facade on first import instead of injecting every built-in at startup. The manifest should be the single source for resolution, documentation, and the compatibility test matrix.

## Synchrony is the hard boundary

Deno can expose true synchronous ops because Rust is called directly from the embedded V8 isolate. Its op generator distinguishes regular, eager async, lazy async, and deferred async behavior ([Deno op2 async documentation](https://github.com/denoland/deno/blob/131a72736f59fb00185b1974806f5ad8ede46717/libs/ops/op2/README.md#L24-L93)). That mechanism cannot be copied through Wry message passing.

For portable `ass` code:

- pure JavaScript synchronous APIs are fine (`path.join`, `Buffer.from`, assertions);
- native callback and Promise APIs can use asynchronous IPC;
- native synchronous APIs such as `readFileSync`, `statSync`, `execSync`, synchronous zlib, and streaming `createHash().digest()` cannot be faithfully implemented by the current bridge;
- returning a Promise from a `*Sync` method is incompatible and must not be done.

`SharedArrayBuffer` is not a portable escape hatch. `Atomics.wait` requires a blockable agent; Web main threads are not blockable, and the operation throws when the current agent cannot block ([ECMAScript `DoWait`](https://tc39.es/ecma262/multipage/structured-data.html#sec-dowait), [HTML agent setup](https://html.spec.whatwg.org/multipage/webappapis.html#integration-with-the-javascript-agent-formalism)). Synchronous XHR to a custom protocol would also couple browser re-entrancy and platform-specific protocol handlers, and is unsuitable as the runtime ABI.

The recommended policy is:

1. Implement synchronous methods only when they are wholly implemented in JavaScript/WebAssembly or use data already snapshotted into the realm.
2. Mark native synchronous methods unsupported with a Node-style error and list them explicitly in the compatibility matrix.
3. If full synchronous native compatibility becomes a requirement, treat it as a runtime-model decision: it requires a direct engine embedding/FFI path, not another layer on the current IPC Promise.

This limitation should be explicit in project messaging. LLRT can implement synchronous native modules because it embeds QuickJS and Rust bindings; its reusable modules are `rquickjs` modules, not WebView polyfills ([LLRT Modules README](https://github.com/awslabs/llrt/blob/main/llrt_modules/README.md)). WinterJS likewise embeds SpiderMonkey in a Rust runtime ([official WinterJS announcement](https://wasmer.io/posts/announcing-winterjs-service-workers)). Both are useful comparisons, but adopting their direct-call architecture means abandoning the main size advantage of `ass`.

## Binary transport

JSON arrays are unacceptable for file, socket, compression, and crypto payloads. Base64 is a useful compatibility fallback but increases payload size and allocates on both sides.

Deno's direct V8 boundary can borrow buffers for fast calls, copy them for safety, or detach a `JsBuffer` to transfer ownership. The documentation also calls serde the legacy/slow path ([Deno op2 buffer conversions](https://github.com/denoland/deno/blob/131a72736f59fb00185b1974806f5ad8ede46717/libs/ops/op2/README.md#L815-L1048)). Wry does not provide that direct memory relationship.

Use two transports in `ass`:

1. **Control plane:** small JSON messages through `window.ipc.postMessage`, containing IDs, scalar arguments, metadata, and errors.
2. **Data plane:** byte responses through an asynchronous `ass:` custom protocol and `fetch(...).arrayBuffer()` for Rust-to-JS bulk data.

Wry's asynchronous custom protocol receives `Request<Vec<u8>>`, supplies a `Send` responder, and can complete after work on another thread ([Wry asynchronous custom protocol](https://docs.rs/wry/0.56.0/wry/struct.WebViewBuilder.html#method.with_asynchronous_custom_protocol), [`RequestAsyncResponder`](https://docs.rs/wry/0.56.0/wry/struct.RequestAsyncResponder.html)). This avoids JSON/base64 for read results, although it should not be advertised as zero-copy because each platform WebView may still copy internally.

For JS-to-Rust bulk writes, retain a chunked base64 fallback initially. Wry gates Linux custom-protocol request bodies behind its `linux-body` feature and requires WebKitGTK 2.40 or newer ([Wry feature flags](https://github.com/tauri-apps/wry/blob/5c9b89920f3c6abf90b9c539fad2e352d24d179a/README.md#feature-flags)). Enabling binary POST bodies therefore changes the Linux runtime baseline and needs a deliberate compatibility decision.

Tauri v2 demonstrates the target shape: ordinary command values are JSON-serialized, while raw `ArrayBuffer`/`Uint8Array` request bodies and `ipc::Response` provide an optimized byte path; channels are recommended for streams ([Tauri calling Rust](https://v2.tauri.app/develop/calling-rust/#returning-array-buffers), [Tauri channels](https://v2.tauri.app/develop/calling-rust/#channels)). `ass` uses bare Wry, so it must build only the small subset of this protocol that it needs rather than assuming Tauri's command layer is present.

Suggested wire shapes:

```json
{ "v": 1, "kind": "op", "realm": 7, "call": 42, "op": "fs.open", "args": { "path": "x", "flags": 0 } }
{ "v": 1, "kind": "ok", "realm": 7, "call": 42, "value": { "rid": 9 } }
{ "v": 1, "kind": "err", "realm": 7, "call": 42, "error": { "name": "Error", "code": "ENOENT", "message": "...", "path": "x", "syscall": "open" } }
{ "v": 1, "kind": "event", "realm": 7, "rid": 9, "event": "data", "value": { "ticket": "...", "length": 65536 } }
```

The `ticket` is a short-lived, realm-bound, single-use URL capability for the data-plane fetch. Bound the chunk size and total queued bytes so a fast native producer cannot exhaust memory while the WebView is slow.

## Permissions and trust boundary

Adding `fs`, `net`, or `child_process` turns a browser-like evaluator into a host-capable runtime. The sandboxed iframe does not protect the host once it can forward privileged native calls.

Deno denies filesystem, network, environment, subprocess, and other sensitive access by default and lets grants be scoped to paths, hosts, environment keys, or executables. All code on one thread shares its permission level, and checks are enforced by the runtime rather than trusted to user JavaScript ([Deno security model](https://docs.deno.com/runtime/fundamentals/security/#permissions), [permission reference](https://docs.deno.com/runtime/reference/permissions/)). Deno's Node filesystem ops check the path before using the filesystem, and TCP connection handling checks both the requested hostname and the resolved address to prevent address-based bypasses ([filesystem checks](https://github.com/denoland/deno/blob/131a72736f59fb00185b1974806f5ad8ede46717/ext/node/ops/fs.rs#L306-L445), [TCP checks](https://github.com/denoland/deno/blob/131a72736f59fb00185b1974806f5ad8ede46717/ext/node/ops/tcp_wrap.rs#L689-L793)).

Create a Rust `CapabilityContext` per evaluation:

```text
read:  canonical path prefixes
write: canonical path prefixes
net:   host/port rules plus resolved-address checks
env:   named keys
run:   canonical executable allowlist
sys:   selected OS information
```

Rules:

- Never trust a JavaScript-side permission decision.
- Canonicalize with operation-appropriate symlink behavior and prevent time-of-check/time-of-use mistakes where possible.
- A daemon client must supply no more authority than the daemon was started with; it must not inherit authority from a previous request.
- `run` is especially dangerous because a subprocess is not constrained by an in-process permission table. Deno's documentation treats broad subprocess and FFI grants as effectively bypassing the sandbox ([Deno security guidance](https://docs.deno.com/runtime/fundamentals/security/#permissions-that-bypass-the-sandbox)).
- Start with explicit CLI flags and non-interactive denial. Interactive prompts can be a later feature, but must not block daemon protocol handling unexpectedly.

## Module placement

The following is an implementation map, not a claim of complete Node compatibility.

| Group | Preferred implementation | Notes |
| --- | --- | --- |
| `assert`, `events`, `path`, `path/posix`, `path/win32`, `querystring`, `string_decoder`, most of `util/types` | WebView JavaScript | Pure semantics; test against Node fixtures. |
| `buffer` | WebView JavaScript, selectively optimized | Build on typed arrays. Node's aliasing, encodings, integer methods, pool behavior, and error shapes require extensive tests. |
| `url`, `timers`, `timers/promises`, `perf_hooks`, `stream/web` | Web APIs plus JS facade | Do not assume every platform WebView exposes identical recent APIs; feature-detect and polyfill. |
| `console`, `process`, `os`, `tty` | Hybrid | Formatting/events in JS; argv, cwd, env, signals, TTY and OS data from Rust with permissions where sensitive. |
| `crypto` | Hybrid | Reuse `crypto.subtle`, `getRandomValues`, and `randomUUID` where semantics match; use Rust or JS/Wasm for Node-only streaming/synchronous algorithms, key objects, ciphers, OpenSSL-shaped options, and exact errors. Deno also combines WebCrypto with native ops ([Deno crypto facade](https://github.com/denoland/deno/blob/131a72736f59fb00185b1974806f5ad8ede46717/ext/node/polyfills/crypto.ts#L22-L132)). |
| `fs/promises`, asynchronous/callback `fs`, `dns` | Rust resources + JS facade | All OS access and permission checks in Rust; callback APIs wrap the same Promise primitive. Native `*Sync` remains unsupported unless a true sync path exists. |
| `net`, `dgram`, `tls` | Rust resources + JS events/streams | Needs backpressure, half-close, address objects, cancellation, ref/unref, and server accept events. |
| `http`, `https`, `http2` | Hybrid, built above transport resources | Browser `fetch` is useful for a small client subset but cannot expose Node socket/Agent/server semantics. Full compatibility belongs above Rust network/TLS resources. |
| `child_process` | Rust resources + JS facade | Spawn/kill/wait and stdio in Rust; permission by canonical executable. `execSync`/`spawnSync` unsupported on the WebView bridge. |
| `zlib` | Rust or portable Wasm + JS streams | Browser compression APIs do not cover all Node formats/options and synchronous APIs. Rust is the clearer cross-platform source of truth. |
| `readline`, `repl`, `test` | Mostly JS with host hooks | Build after streams, TTY, process and lifecycle semantics are stable. |
| `async_hooks`, `cluster`, `inspector`, `v8`, `vm`, `worker_threads`, `wasi` | Explicitly unsupported initially | These depend on engine/runtime internals or require a separate worker/WASI design. Stubs that silently do nothing are worse than a clear import/method error. |

For `crypto`, “available in the WebView” is necessary but not sufficient. WebCrypto is Promise-based and one-shot for digest operations, while Node exposes synchronous and streaming APIs. A facade must compare behavior method by method, not map module names wholesale.

## Other runtimes

### Deno

Best model for layering, resource IDs, permission checks, lazy built-ins, and compatibility testing. Not reusable as a dependency without embedding V8 and a large part of Deno.

### LLRT

LLRT is written in Rust, embeds QuickJS, and openly states that it implements only a fraction of Node APIs and is not a drop-in replacement ([LLRT README and matrix](https://github.com/awslabs/llrt#compatibility-matrix)). Its Node/Winter-compatible modules are separated into feature-gated crates and assembled by a module builder ([LLRT Modules](https://github.com/awslabs/llrt/blob/main/llrt_modules/README.md)). The useful lesson for `ass` is modular registration and honest per-module compatibility. Its direct Rust/QuickJS bindings cannot solve Wry IPC constraints.

### WinterJS

WinterJS is a Rust service-worker runtime embedding SpiderMonkey and using Tokio/WASIX ([official announcement](https://wasmer.io/posts/announcing-winterjs-service-workers)). It validates the “JS facade around a Rust async host” idea, but its scope is WinterCG/service workers rather than Node compatibility, and it ships an engine. It is not a closer fit than Deno for the `ass` boundary.

## Suggested implementation order

1. **Freeze the ABI.** Add versioned op/result/error/event envelopes, `RealmId`, cancellation, and typed Rust dispatch. Make unknown operations fail closed.
2. **Add resource and liveness foundations.** Implement resource ownership, close-all-on-realm-destroy, ref/unref, pending-op accounting, and backpressure before sockets or children.
3. **Add permissions.** Establish CLI flags and a Rust `CapabilityContext` before exposing privileged modules.
4. **Finish pure modules.** Use Node's own test fixtures/behavior as the target for `assert`, `buffer`, `events`, `path`, `querystring`, `string_decoder`, `timers`, `url`, and utilities.
5. **Prove one native vertical slice.** Implement `fs/promises` open/read/write/close/stat with structured Node errors and realm cleanup.
6. **Add the binary data plane.** Benchmark IPC JSON/base64 against custom-protocol `ArrayBuffer` reads on all three platforms; set chunk and queue limits.
7. **Build streams and transport resources.** Then implement `net`/DNS, followed by HTTP/TLS and child processes.
8. **Add hybrid crypto and compression.** Prefer Web APIs only where their observable semantics match; keep a compatibility table per method.

## Compatibility and verification

“Module imports” is too weak a definition of support. Keep a checked-in matrix at symbol granularity:

```text
module | export/method | sync/callback/promise | platform | status | test source | notes
```

Use these status values consistently:

- `supported`: behavior and errors covered on macOS, Windows, and Linux;
- `partial`: documented missing overloads/options or platform differences;
- `stub`: import-compatible but deliberately non-functional, only when ecosystem compatibility justifies it;
- `unsupported`: fails clearly.

For every native module, test:

- success and Node-style error properties (`code`, `errno`, `syscall`, path/address fields);
- cancellation and abort signals;
- resource cleanup on success, error, iframe removal, daemon disconnect, and process exit;
- permission denial and path/address bypass attempts;
- ref/unref and one-shot process liveness;
- slow-consumer backpressure and bounded memory;
- binary round trips including zero length, partial reads/writes, and large buffers;
- macOS/WKWebView, Windows/WebView2, and Linux/WebKitGTK behavior.

Pin a Node major as the compatibility target rather than tracking “latest” implicitly. Record deliberate divergences in the matrix. Deno and LLRT both expose explicit compatibility surfaces rather than claiming that module presence implies completeness ([Deno Node API index](https://docs.deno.com/api/node/about/), [LLRT compatibility matrix](https://github.com/awslabs/llrt#compatibility-matrix)).

## Decisions to make before broad implementation

1. Which Node major is the target?
2. Are native synchronous APIs explicitly out of scope for the WebView runtime?
3. Is the default permission model Node-like full authority or Deno-like deny-by-default? Deny-by-default is recommended.
4. May Linux require WebKitGTK 2.40+ for request-body binary transport, or must base64 remain the universal upload path?
5. Should a one-shot program remain alive for referenced native resources after its top-level Promise settles? Node compatibility requires yes.

The first two decisions define what “most built-ins” can honestly mean. Without them, it is easy to accumulate modules that import successfully but cannot preserve Node's synchronization and lifecycle semantics.
