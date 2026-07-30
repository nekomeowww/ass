# Eval import

This example has no build step, IIFE wrapper, or local npm dependencies. `ass` loads `index.mjs` as a real ES module with top-level await. That module imports unrtel from `esm.sh`; unrtel then rewrites the static imports in the source string and dynamically imports `lodash-es` and `date-fns` from the same CDN inside the system WebView.

From the repository root:

```sh
cargo build
target/debug/ass examples/eval-import/index.mjs
```

Network access to `https://esm.sh` is required at runtime.
