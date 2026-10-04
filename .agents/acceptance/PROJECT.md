# PROJECT.md — acceptance adapter for ass

## 1. Project summary

`ass` is a Rust command-line runtime that executes JavaScript and TypeScript in
the operating system WebView. The CLI and runtime live under `src/`; JavaScript
bridge and Node.js compatibility packages live under `packages/`; end-to-end
Node.js compatibility coverage lives under `tests/node-builtins/`.

## 2. Environment

- **Start dev server:** n/a; `ass` is a CLI and has no development server.
- **Stop dev server:** n/a.
- **Required services:** none.
- **Already-running detection:** n/a; each CLI invocation is a separate process.
- **Env / port resolution:** n/a; build with `cargo build` and run
  `target/debug/ass`. The daemon transport selects its own local socket or pipe.

## 3. Auth

- **Test account(s):** none.
- **Seeding command:** n/a.
- **Per-surface status check:**
  - CLI: n/a; the product CLI does not require authentication.

## 4. Surfaces

### CLI

- Invocation: build with `cargo build`, then run `target/debug/ass`; use
  `/usr/bin/expect` when a real interactive terminal is required.
- Auth: see §3 CLI.
- Standalone install: `pnpm install --frozen-lockfile` for JavaScript workspace
  tooling, followed by the Rust build from the repository root.

## 5. Project probes & quick navigation

- Auth probe: n/a.
- Route probe: n/a.
- Operations probe: `target/debug/ass daemon status` when daemon behavior is in
  scope.
- Quick navigation: n/a.
- CLI readiness probe: `target/debug/ass --help`.
- Interactive REPL probe: drive `target/debug/ass` through `/usr/bin/expect` and
  assert on the prompt, submitted input, and output.

## 6. Known constraints

- macOS uses WKWebView and supports interactive PTY verification locally.
- Linux requires GTK and WebKitGTK development/runtime packages; headless
  execution may require `xvfb-run`.
- Windows uses WebView2; daemon transport is not implemented there yet.
- Editing `packages/bridge/src` requires rebuilding the checked-in bridge output
  before compiling Rust.
