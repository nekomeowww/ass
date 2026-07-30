# Module import ESM

This example runs an unbundled TypeScript module graph. It exercises a static local import,
a dynamic local import, top-level await, and an HTTPS import from esm.sh.

From the repository root:

```sh
cargo build
target/debug/ass examples/module-import-esm/main.ts
target/debug/ass --reuse examples/module-import-esm/main.ts
```
