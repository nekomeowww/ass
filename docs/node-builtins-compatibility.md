# Node.js built-in compatibility

Target: Node.js 24 ESM APIs. This matrix describes the implemented surface; importing a module does not imply every Node API is supported.

Status meanings:

- **supported**: the listed behavior has Node/ass comparison coverage;
- **partial**: useful behavior is implemented with documented omissions;
- **unsupported**: the API fails explicitly instead of returning incompatible data.

| Module | Surface | Placement | Status | Notes |
| --- | --- | --- | --- | --- |
| `node:assert`, `node:assert/strict` | common equality, deep equality, throws/rejects, match APIs | WebView | partial | Exact Node error messages and all overloads are not yet matched. |
| `node:buffer` | construction, encodings, concat, compare, slice, string conversion | WebView | partial | Advanced numeric read/write APIs, pooling and transcode parity remain. |
| `node:console` | global console exports and stream-backed `Console` class | WebView | partial | Inspector formatting, color-mode negotiation and all stream error behavior remain. |
| `node:constants` | filesystem access and copy-file constants | WebView | partial | Platform, signal, crypto, TLS and OS constants remain. |
| `node:crypto` | WebCrypto, random UUID/bytes/int/fill, timing-safe equality | WebView | partial | Node streaming hashes, ciphers, key objects and synchronous OpenSSL APIs remain. |
| `node:dgram` | UDP bind/send/receive/connect, address metadata and close | Realm-owned Rust resource + JS facade | partial | Multicast, disconnect, socket buffer tuning and exact ref/unref behavior remain. |
| `node:diagnostics_channel` | channels, subscribers, stores and tracing wrappers | WebView | partial | Async-context propagation and callback tracing edge cases remain. |
| `node:dns`, `node:dns/promises` | lookup, lookupService and A/AAAA resolve | Rust worker + JS callback/promise facades | partial | Custom DNS servers and non-address record types remain. |
| `node:domain` | stack, emitter membership, bind/intercept and error routing | WebView | partial | Full async propagation and deprecated Node internals remain. |
| `node:events` | `EventEmitter`, `once`, async `on`, listener helpers | WebView | partial | Capture-rejections and exact warning behavior remain. |
| `node:http` | HTTP/1.1 local client/server, headers and streamed request/response bodies | TCP resource + JS parser/facade | partial | Keep-alive pooling, chunked decoding, upgrades, trailers, CONNECT and proxy support remain. |
| `node:module` | builtin metadata, `isBuiltin`, source-map settings and module records | WebView | partial | CommonJS loading, hooks, compile cache, package lookup and source maps remain. |
| `node:net` | TCP clients/servers, Socket/Duplex integration, half-close and address metadata | Realm-owned Rust resources + JS facade | partial | Unix sockets, auto-family racing, keepalive tuning and exact backpressure/ref semantics remain. |
| `node:os` | platform identity, CPU count, memory, uptime, load, user and path information | Rust startup snapshot + JS facade | partial | Live interfaces, exact CPU metrics, cross-platform free memory and priority mutation remain. |
| `node:path` | default platform path API plus `posix` and `win32` | WebView | partial | Common normalization, join, resolve, relative and parse/format behavior is covered. Device/UNC edge cases remain. |
| `node:perf_hooks` | Web Performance exports, timerify and lightweight histograms | WebView | partial | Native event-loop delay sampling, GC entries and exact histogram statistics remain. |
| `node:process` | global/default/named process metadata, env, events, timing, nextTick, stdio adapters and per-evaluation exit | Rust snapshot + WebView facade | partial | `chdir` and other synchronous host mutations throw `ERR_ASS_SYNC_UNSUPPORTED`; signals, memory/resource usage and exact next-tick phase ordering remain. |
| `node:punycode` | Bootstring encode/decode, domain conversion and UCS-2 helpers | WebView | partial | Node's deprecation warning and exact malformed-input messages are not reproduced. |
| `node:querystring` | parse/stringify and aliases | WebView | partial | Legacy malformed-escape edge cases remain. |
| `node:readline`, `node:readline/promises` | line events, questions, prompts and ANSI cursor helpers | WebView streams | partial | Full terminal editing, completion, history and signal behavior remain. |
| `node:repl` | non-terminal line evaluation, custom writer and commands | WebView readline/eval | partial | Node context isolation, recoverable parser state, completion and history remain. |
| `node:stream`, `node:stream/consumers`, `node:stream/promises` | readable/writable/duplex/transform streams, piping, consumers and promise helpers | WebView | partial | Full backpressure, corking, all object-mode and destroy/error ordering details remain. |
| `node:string_decoder` | streaming decode through `TextDecoder` | WebView | partial | Node's incomplete-sequence bookkeeping differs by WebView implementation. |
| `node:stream/web` | readable, writable, transform, text and compression Web Streams exports | WebView globals | partial | BYOB constructors remain unavailable when the host WebView does not expose them. |
| `node:sys` | deprecated alias of the implemented `node:util` surface | WebView | partial | Has the same omissions as `node:util`; deprecation warning emission is not reproduced. |
| `node:timers` | timeout/interval/immediate APIs | WebView | partial | Handle objects and `ref`/`unref` are not implemented. |
| `node:timers/promises` | timeout, immediate, interval, scheduler | WebView | partial | Scheduler and abort error details are not exact. |
| `node:tty` | TTY detection plus readable/writable wrappers and ANSI cursor methods | Process snapshot + WebView streams | partial | Raw stdin transport, real terminal sizing and platform ioctl behavior remain. |
| `node:url` | WHATWG classes, file URL conversion, legacy parse/format subset | WebView | partial | IDNA Unicode conversion and legacy URL edge cases remain. |
| `node:util`, `node:util/types` | promisify/callbackify, format/inspect subset, parseArgs and all Node 24 type-predicate export names | WebView | partial | Inspect formatting is intentionally smaller; predicates requiring engine internals (`isProxy`, `isExternal`, `isKeyObject`) conservatively return false. |
| `node:worker_threads` | main-thread metadata, environment data and Web messaging primitives | WebView | partial | Node Worker loading/thread lifecycle, resource limits and synchronous message receive remain. |
| `node:zlib` | async gzip/deflate functions and Transform streams plus CRC32 | WebView CompressionStream | partial | Brotli, Zstd, synchronous codecs, dictionaries, tuning and exact zlib errors remain. |
| `node:fs/promises` | read/write/append, stat/lstat, directory listing, mkdir/rm, rename/copy/access/realpath | Rust async ops + JS facade | partial | Data currently uses the documented base64 fallback. Open file resources, watchers, chmod/link APIs and abort support remain. |
| `node:fs` | callbacks over the promise surface | Rust async ops + JS facade | partial | Native `*Sync` methods throw `ERR_ASS_SYNC_UNSUPPORTED`. |
| `node:child_process` | buffered `exec`/`execFile`, timeout/max-buffer enforcement, streaming `spawn`, kill and stdio resources | Realm-owned Rust resource + JS facade | partial | `fork`/IPC, exact signal reporting, advanced stdio handles and synchronous APIs remain. Sync APIs throw `ERR_ASS_SYNC_UNSUPPORTED`. |

Compatibility fixtures live in `tests/node-builtins/fixtures`. `pnpm test:node-builtins` builds `ass`, runs every fixture under Node.js and `ass`, and compares their observable output.

## Runtime boundary

Privileged operations currently follow Node's local-runtime authority model: evaluated code can access the same filesystem and subprocess authority as the `ass` process. Do not run untrusted code. A future capability/permission layer must enforce checks in Rust; a sandboxed iframe alone is not a host security boundary.

The native protocol is versioned and carries a realm ID and call ID. Native work runs on a bounded worker pool away from the WebView event loop, and late results from a completed isolated realm are discarded. The persistent main WebView has one stable realm ID across REPL evaluations. TCP, UDP, TLS and child-process resources use opaque realm-owned resource IDs. Closing a realm rejects pending bridge promises, cancels blocking resource work and releases every owned resource. Future file handles and watchers must use the same resource table rather than introducing independent lifetime management.
