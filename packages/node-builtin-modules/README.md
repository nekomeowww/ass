# @ass/node-builtin-modules

TypeScript implementations of the Node.js built-in modules exposed by `ass`.
Source directories and files follow Node.js specifier names: for example,
`src/modules/fs/index.ts` implements `node:fs`, while
`src/modules/fs/promises.ts` implements `node:fs/promises`.

Package-internal dependencies use the package name:

```ts
import { Buffer } from '@ass/node-builtin-modules/buffer'
```

The tsdown plugin rewrites these dependencies to runtime built-in specifiers and
keeps them external:

```ts
import { Buffer } from 'node:buffer'
```

The build emits self-contained ESM entries and `dist/manifest.json`. Cargo's
`build.rs` consumes that manifest and generates the static Rust module registry.
Shared chunks are rejected because the runtime loader addresses built-ins only by
their `node:` specifier.

```sh
pnpm --filter @ass/node-builtin-modules test
```

The migrated implementations are checked by TypeScript with relaxed strictness.
New modules should add explicit types, and existing modules can enable strictness
incrementally as their Node.js overloads are modeled.
