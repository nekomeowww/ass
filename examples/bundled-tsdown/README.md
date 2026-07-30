# tsdown / Rolldown bundle

This example imports `camelCase` and `chunk` from `lodash-es` in TypeScript. tsdown uses Rolldown to tree-shake the dependency and emit one browser ES module with a real export and no external runtime imports. `ass` then loads that generated `.mjs` module directly.

From the repository root:

```sh
cargo build
pnpm --dir examples/bundled-tsdown install
pnpm --dir examples/bundled-tsdown test
```
