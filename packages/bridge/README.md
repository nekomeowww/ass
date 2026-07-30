# @ass/bridge

TypeScript sources for the scripts injected into the system WebView. tsdown bundles each entry as
a browser IIFE because Wry initialization scripts execute as classic scripts.

```sh
pnpm install
pnpm --filter @ass/bridge test
```

The generated `dist/core/core.js` and `dist/isolated-realm/isolated-realm.js` files are embedded
into the Rust binary with `include_str!`.
