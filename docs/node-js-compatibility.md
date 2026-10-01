# Node.js compatibility

This document records the measurable Node.js built-in module compatibility of `ass`.
The implementation target is Node.js 24 ESM APIs. The current baseline was measured
against Node.js v24.14.0 on 2026-08-05.

Import coverage, export-name coverage, and behavioral compatibility are separate
measurements. An exported name does not count as behavioral parity when it throws an
`ERR_ASS_UNSUPPORTED` or `ERR_ASS_SYNC_UNSUPPORTED` error, and an API without an
explicit stub may still implement only a subset of Node.js behavior.

## Summary

| Measurement | ass | Node.js 24 baseline | Coverage |
| --- | ---: | ---: | ---: |
| Public built-in specifiers | 45 | 58 | 77.6% |
| Public built-in module families | 34 | 45 | 75.6% |
| Matching named-export appearances | 722 | 1,377 | 52.4% |
| Matching named-export appearances, excluding 48 explicit stubs | 674 | 1,377 | 48.9% |
| Matching exports within the 45 implemented specifiers | 722 | 1,247 | 57.9% |
| Matching exports within implemented specifiers, excluding explicit stubs | 674 | 1,247 | 54.1% |
| Modules with complete Node.js API and behavioral parity | 0 | 45 families | 0% |

For a module-level status indicator, use **34/45 families (75.6%)**. The
named-export figure of **48.9%** is a conservative proxy for the total built-in API
surface, but it is still an upper bound: partial implementations and untested edge
cases are not subtracted from it.

## Implemented specifiers

`Node exports` is the number of ESM exports exposed by Node.js v24.14.0. `Matching`
counts names also exported by `ass`. `Explicit stubs` counts matching exports that
immediately report an unsupported operation. `Upper bound` subtracts those stubs;
it does not imply full semantic compatibility.

| Specifier | Node exports | Matching | Explicit stubs | Non-stub upper bound | Coverage | Differential fixture | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| `node:assert` | 23 | 20 | 0 | 20 | 87.0% | — | Partial |
| `node:assert/strict` | 23 | 20 | 0 | 20 | 87.0% | `pure.mjs` | Partial |
| `node:buffer` | 15 | 12 | 0 | 12 | 80.0% | `buffer-inspect.mjs`, `pure.mjs` | Partial |
| `node:child_process` | 10 | 9 | 4 | 5 | 50.0% | `child-process.mjs` | Partial |
| `node:console` | 26 | 24 | 0 | 24 | 92.3% | `additional-pure-builtins.mjs` | Partial |
| `node:constants` | 231 | 11 | 0 | 11 | 4.8% | `additional-pure-builtins.mjs` | Partial |
| `node:crypto` | 70 | 15 | 0 | 15 | 21.4% | `pure.mjs` | Partial |
| `node:dgram` | 4 | 3 | 0 | 3 | 75.0% | `dgram.mjs` | Partial |
| `node:diagnostics_channel` | 7 | 7 | 0 | 7 | 100.0% | `additional-pure-builtins.mjs` | Partial |
| `node:dns` | 51 | 36 | 0 | 36 | 70.6% | `dns.mjs` | Partial |
| `node:dns/promises` | 47 | 35 | 0 | 35 | 74.5% | `dns.mjs` | Partial |
| `node:domain` | 6 | 6 | 0 | 6 | 100.0% | `additional-pure-builtins.mjs` | Partial |
| `node:events` | 16 | 8 | 0 | 8 | 50.0% | `pure.mjs` | Partial |
| `node:fs` | 105 | 34 | 15 | 19 | 18.1% | `fs.mjs` | Partial |
| `node:fs/promises` | 34 | 16 | 0 | 16 | 47.1% | `detached-native-op.mjs`, `fs.mjs`, `readdir-inspect.mjs` | Partial |
| `node:http` | 22 | 22 | 2 | 20 | 90.9% | `http.mjs` | Partial |
| `node:https` | 7 | 7 | 0 | 7 | 100.0% | `tls-https.mjs` | Partial |
| `node:module` | 31 | 10 | 0 | 10 | 32.3% | `module.mjs` | Partial |
| `node:net` | 18 | 17 | 0 | 17 | 94.4% | `net.mjs` | Partial |
| `node:os` | 24 | 24 | 1 | 23 | 95.8% | `os.mjs` | Partial |
| `node:path` | 18 | 16 | 0 | 16 | 88.9% | `pure.mjs` | Partial |
| `node:path/posix` | 18 | 15 | 0 | 15 | 83.3% | `pure.mjs` through `node:path` | Partial |
| `node:path/win32` | 18 | 15 | 0 | 15 | 83.3% | `pure.mjs` through `node:path` | Partial |
| `node:perf_hooks` | 14 | 14 | 0 | 14 | 100.0% | `additional-pure-builtins.mjs` | Partial |
| `node:process` | 84 | 31 | 1 | 30 | 35.7% | `process.mjs`, `process-exit.mjs` | Partial |
| `node:punycode` | 7 | 7 | 0 | 7 | 100.0% | `punycode-stream-web.mjs` | Partial |
| `node:querystring` | 8 | 8 | 0 | 8 | 100.0% | `pure.mjs` | Partial |
| `node:readline` | 9 | 9 | 0 | 9 | 100.0% | `readline-tty.mjs` | Partial |
| `node:readline/promises` | 4 | 4 | 0 | 4 | 100.0% | `readline-tty.mjs` | Partial |
| `node:repl` | 8 | 8 | 0 | 8 | 100.0% | `repl-worker.mjs` | Partial |
| `node:stream` | 24 | 24 | 0 | 24 | 100.0% | `stream.mjs` | Partial |
| `node:stream/consumers` | 7 | 7 | 0 | 7 | 100.0% | `stream.mjs` | Partial |
| `node:stream/promises` | 3 | 3 | 0 | 3 | 100.0% | `stream.mjs` | Partial |
| `node:stream/web` | 18 | 18 | 0 | 18 | 100.0% | `punycode-stream-web.mjs` | Partial |
| `node:string_decoder` | 2 | 2 | 0 | 2 | 100.0% | — | Partial |
| `node:sys` | 35 | 22 | 0 | 22 | 62.9% | `additional-pure-builtins.mjs` | Partial |
| `node:timers` | 8 | 7 | 0 | 7 | 87.5% | — | Partial |
| `node:timers/promises` | 5 | 5 | 0 | 5 | 100.0% | `pure.mjs` | Partial |
| `node:tls` | 19 | 19 | 1 | 18 | 94.7% | `tls-https.mjs` | Partial |
| `node:url` | 15 | 12 | 0 | 12 | 80.0% | — | Partial |
| `node:util` | 35 | 22 | 0 | 22 | 62.9% | `object-inspect.mjs`, `pure.mjs` | Partial |
| `node:util/types` | 44 | 44 | 0 | 44 | 100.0% | `additional-pure-builtins.mjs` | Partial |
| `node:worker_threads` | 22 | 22 | 1 | 21 | 95.5% | `repl-worker.mjs` | Partial |
| `node:zlib` | 48 | 48 | 23 | 25 | 52.1% | `zlib.mjs` | Partial |

Percentages in this table use `Non-stub upper bound / Node exports`. A 100% row means
that every Node.js export name is present and not an explicit unsupported stub. It
does not mean that all overloads, errors, scheduling behavior, or platform edge cases
match Node.js.

## Module-family status

| Status | Count | Module families |
| --- | ---: | --- |
| Partial | 34 | `assert`, `buffer`, `child_process`, `console`, `constants`, `crypto`, `dgram`, `diagnostics_channel`, `dns`, `domain`, `events`, `fs`, `http`, `https`, `module`, `net`, `os`, `path`, `perf_hooks`, `process`, `punycode`, `querystring`, `readline`, `repl`, `stream`, `string_decoder`, `sys`, `timers`, `tls`, `tty`, `url`, `util`, `worker_threads`, `zlib` |
| Unsupported | 11 | `async_hooks`, `cluster`, `http2`, `inspector`, `sea`, `sqlite`, `test`, `trace_events`, `v8`, `vm`, `wasi` |
| Complete | 0 | — |

## Complete public specifier inventory

This table lists all 58 public entries exposed by `module.builtinModules` in the
Node.js v24.14.0 baseline after excluding underscore-prefixed internal modules.
`Unsupported` means importing the specifier through `ass` currently fails explicitly;
it does not describe whether a related Web API or global object exists.

| Specifier | Family | Status |
| --- | --- | --- |
| `node:assert` | `assert` | Partial |
| `node:assert/strict` | `assert` | Partial |
| `node:async_hooks` | `async_hooks` | Unsupported |
| `node:buffer` | `buffer` | Partial |
| `node:child_process` | `child_process` | Partial |
| `node:cluster` | `cluster` | Unsupported |
| `node:console` | `console` | Partial |
| `node:constants` | `constants` | Partial |
| `node:crypto` | `crypto` | Partial |
| `node:dgram` | `dgram` | Partial |
| `node:diagnostics_channel` | `diagnostics_channel` | Partial |
| `node:dns` | `dns` | Partial |
| `node:dns/promises` | `dns` | Partial |
| `node:domain` | `domain` | Partial |
| `node:events` | `events` | Partial |
| `node:fs` | `fs` | Partial |
| `node:fs/promises` | `fs` | Partial |
| `node:http` | `http` | Partial |
| `node:http2` | `http2` | Unsupported |
| `node:https` | `https` | Partial |
| `node:inspector` | `inspector` | Unsupported |
| `node:inspector/promises` | `inspector` | Unsupported |
| `node:module` | `module` | Partial |
| `node:net` | `net` | Partial |
| `node:os` | `os` | Partial |
| `node:path` | `path` | Partial |
| `node:path/posix` | `path` | Partial |
| `node:path/win32` | `path` | Partial |
| `node:perf_hooks` | `perf_hooks` | Partial |
| `node:process` | `process` | Partial |
| `node:punycode` | `punycode` | Partial |
| `node:querystring` | `querystring` | Partial |
| `node:readline` | `readline` | Partial |
| `node:readline/promises` | `readline` | Partial |
| `node:repl` | `repl` | Partial |
| `node:stream` | `stream` | Partial |
| `node:stream/consumers` | `stream` | Partial |
| `node:stream/promises` | `stream` | Partial |
| `node:stream/web` | `stream` | Partial |
| `node:string_decoder` | `string_decoder` | Partial |
| `node:sys` | `sys` | Partial |
| `node:timers` | `timers` | Partial |
| `node:timers/promises` | `timers` | Partial |
| `node:tls` | `tls` | Partial |
| `node:trace_events` | `trace_events` | Unsupported |
| `node:tty` | `tty` | Partial |
| `node:url` | `url` | Partial |
| `node:util` | `util` | Partial |
| `node:util/types` | `util` | Partial |
| `node:v8` | `v8` | Unsupported |
| `node:vm` | `vm` | Unsupported |
| `node:wasi` | `wasi` | Unsupported |
| `node:worker_threads` | `worker_threads` | Partial |
| `node:zlib` | `zlib` | Partial |
| `node:sea` | `sea` | Unsupported |
| `node:sqlite` | `sqlite` | Unsupported |
| `node:test` | `test` | Unsupported |
| `node:test/reporters` | `test` | Unsupported |

## Known compatibility boundaries

| Area | Implemented surface | Main omissions |
| --- | --- | --- |
| Filesystem | Buffered asynchronous file and directory operations; callback wrappers | File handles, watchers, permissions, links, streams, and synchronous operations |
| Child processes | Buffered `exec`/`execFile` plus realm-owned streaming `spawn` resources with piped stdin, stdout, and stderr | `fork`/IPC, exact signal reporting, advanced stdio handles, timeout/max-buffer parity, and synchronous operations |
| Process | Metadata, environment, timing, events, stdio adapters, and per-evaluation exit | Signals, memory/resource usage, synchronous host mutations, and exact event-loop phase ordering |
| Crypto | WebCrypto, UUIDs, random bytes/integers/fill, and timing-safe equality | Node.js streaming hashes/ciphers, key objects, certificates, and synchronous OpenSSL APIs |
| Buffer | Common construction, encodings, concatenation, comparison, slicing, and inspection | Numeric read/write coverage, pooling, transcode parity, and edge-case validation |
| Timers | Timeouts, intervals, immediates, and promise adapters | Node.js handle objects, `ref`/`unref`, and exact cancellation/error behavior |
| Formatting | Common object, array, function, collection, Buffer, and ANSI color inspection | Complete `util.inspect` option, custom-inspector, depth, proxy, and getter semantics |
| Diagnostics | Channels, subscription, publication, stores, and tracing wrappers | Async-context propagation and all tracing callback edge cases |
| Domains | Domain stack, emitter membership, binding, interception, and error routing | Full async propagation and Node's deprecated internal integration |
| Performance hooks | Web Performance API exports, timer wrapping, and lightweight histograms | Native event-loop delay sampling, GC entries, and exact histogram statistics |
| Punycode | Bootstring encode/decode, domain conversion, and UCS-2 helpers | Deprecated Node module warning and every malformed-input error-message detail |
| Web streams | WebView-native readable, writable, transform, text, and compression streams | BYOB constructors when the host WebView does not expose them |
| Node streams | Readable, writable, duplex, transform, pipeline, promise helpers, and consumers | Complete backpressure, corking, object-mode edge cases, and every destroy/error ordering rule |
| Networking | Realm-owned TCP clients/servers and UDP sockets with cancellable native reads | Unix sockets, multicast, socket buffer tuning, auto-family racing, and exact ref/unref semantics |
| DNS | Callback and promise lookup, lookupService, and A/AAAA resolution | Dedicated DNS servers and MX/TXT/SRV/PTR/CAA/TLSA record queries |
| HTTP | HTTP/1.1 client/server requests, responses, headers, and streamed bodies | Keep-alive pooling, chunked decoding, upgrades, trailers, CONNECT, proxying, and parser limits |
| TLS/HTTPS | Realm-owned TLS clients/servers, custom trust roots, certificates and keys, SNI, ALPN, and HTTP/1.1 over TLS | Session resumption, renegotiation, key export, complete certificate/cipher metadata, client-certificate verification, and wrapping an existing socket |
| OS | Rust startup snapshot for identity, CPU count, memory, uptime, load, and user info | Live network interfaces, accurate per-CPU timing/speed, free memory on every platform, and priority mutation |
| Readline/REPL/TTY | Line parsing, questions, cursor escapes, non-terminal evaluation, and TTY wrappers | Full terminal editing, completion, history persistence, raw stdin, and signal semantics |
| Worker threads | Main-thread metadata, environment data, and Web MessageChannel/BroadcastChannel | Node worker entry loading, native thread lifecycle, resource limits, and synchronous port receive |
| Compression | Async gzip/deflate functions and transforms using WebView codecs; CRC32 | Brotli, Zstd, synchronous codecs, dictionaries, tuning options, and exact zlib errors |

## Remaining feasibility audit

The remaining 13 public specifiers have been inspected rather than silently omitted.
They are intentionally unregistered until the listed implementation dependency is
available; registering placeholder functions would overstate compatibility.

| Specifier(s) | Required implementation | Current decision |
| --- | --- | --- |
| `node:async_hooks` | Engine-level async lifecycle hooks or a context propagation primitive that survives promises and timers | Deferred; a synchronous-only `AsyncLocalStorage` would be misleading |
| `node:cluster` | IPC channels, worker lifecycle coordination, and shared server handles on top of the new streaming process resources | Process resources now exist; deferred until IPC and shared handles are available |
| `node:http2` | HTTP/2 framing, HPACK, multiplexed stream resources, flow control, and TLS/ALPN | Deferred; HTTP/1.1 support is not a substitute |
| `node:inspector`, `node:inspector/promises` | A supported WebView inspector protocol session and notification bridge | Host capability is not consistently available across system WebViews |
| `node:trace_events` | Native trace event emission and an output sink | Deferred; category bookkeeping without trace output would be a no-op |
| `node:v8` | V8 heap, serializer, coverage, and flag interfaces | Not portable because `ass` runs JavaScriptCore/WebKit, not V8 |
| `node:vm` | Synchronous context creation and execution with Node-compatible identity/isolation | Existing isolated realms are asynchronous and cannot satisfy this interface |
| `node:wasi` | A WASI runtime and file-descriptor/capability adapter | No WASI engine is currently linked |
| `node:sea` | Single-executable asset generation and startup blob integration | Build/distribution feature, not a runtime facade |
| `node:sqlite` | Realm-owned database/statement resources and SQLite binding | Viable future native adapter, but not currently linked |
| `node:test`, `node:test/reporters` | Test scheduler, mocking, snapshots, coverage, reporters, and process integration | Large higher-level module; deferred until core runtime semantics stabilize |

The detailed behavior matrix and runtime security boundary remain documented in
[`node-builtins-compatibility.md`](./node-builtins-compatibility.md).

## Measurement method

The denominator comes from `module.builtinModules` in Node.js v24.14.0. Entries with
an underscore-prefixed internal name, such as `_http_agent` and `_stream_readable`,
are excluded from the public-module count. Subpaths are counted as separate
specifiers and grouped by their first path segment for the family count.

Named-export measurements compare `Object.keys(await import(specifier))` under Node.js
and `ass`. This intentionally counts repeated exports in aliases and subpaths because
each specifier is an independently observable compatibility entry point.

Behavioral fixtures live in [`tests/node-builtins/fixtures`](../tests/node-builtins/fixtures).
Run the Node.js/ass differential suite with:

```sh
pnpm test:node-builtins
```

The TypeScript implementations live in
[`packages/node-builtin-modules`](../packages/node-builtin-modules). Its module
registry drives the tsdown entry map and generated `dist/manifest.json`; Cargo's
`build.rs` consumes the manifest to generate the static Rust loader registry. To add
an entry, register its `node:` specifier and place its source under the matching
`src/modules/<node-module-name>` path.

Node.js documents the built-in ESM export model in its
[ECMAScript modules documentation](https://nodejs.org/download/release/latest-v24.x/docs/api/esm.html#built-in-modules)
and exposes the runtime list through
[`module.builtinModules`](https://nodejs.org/download/release/latest-v24.x/docs/api/module.html#modulebuiltinmodules).
