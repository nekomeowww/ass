# ass

Already Shipped JS (`ass`) is a tiny JavaScript and TypeScript CLI powered by the operating system's WebView. It embeds [wry](https://github.com/tauri-apps/wry) directly.

The release binary is under **0.8 MB** without TypeScript support and only **1.66 MB** with TypeScript enabled.

The JavaScript engine is whatever the platform already ships:

- macOS: WebKit / JavaScriptCore through `WKWebView`
- Windows: Microsoft Edge WebView2
- Linux: WebKitGTK

## Installation

Download prebuilt binaries from [GitHub Releases](https://github.com/nekomeowww/ass-js/releases).

> [!NOTE]
> Each release archive has a matching `.sha256` file for optional checksum verification.

### macOS

```sh
mkdir -p "${HOME}/.local/bin" && curl -fsSL "https://github.com/nekomeowww/ass-js/releases/latest/download/ass-$([ "$(uname -m)" = arm64 ] && echo aarch64 || echo x86_64)-apple-darwin.tar.gz" | tar -xz -C "${HOME}/.local/bin"
```

### Linux

```sh
mkdir -p "${HOME}/.local/bin" && curl -fsSL "https://github.com/nekomeowww/ass-js/releases/latest/download/ass-$([ "$(uname -m)" = aarch64 ] && echo aarch64 || echo x86_64)-unknown-linux-gnu.tar.gz" | tar -xz -C "${HOME}/.local/bin"
```

Ensure `${HOME}/.local/bin` is included in `PATH`.

#### Prerequisites

Install the WebKitGTK 4.1 runtime for your distribution:

```sh
# Debian / Ubuntu
sudo apt update
sudo apt install libwebkit2gtk-4.1-0

# Fedora
sudo dnf install webkit2gtk4.1

# Arch Linux / Manjaro
sudo pacman -S webkit2gtk-4.1
```

Check whether a Wayland or X11 display is available:

```sh
if [ -n "${WAYLAND_DISPLAY:-}" ]; then
  echo "Wayland display: ${WAYLAND_DISPLAY}"
elif [ -n "${DISPLAY:-}" ]; then
  echo "X11 display: ${DISPLAY}"
else
  echo 'No graphical display detected'
fi
```

#### X11 (not recommended)

For a headless Debian or Ubuntu environment, Xvfb can provide a temporary virtual X11 display:

```sh
sudo apt install xvfb
xvfb-run -a ass -p '21 * 2'
```

## Features

- Supports JavaScript and ESM. Specify `--module` explicitly if automatic module detection fails.
- Supports TypeScript, powered by [Oxc](https://oxc.rs/).
- Supports module resolution, including relative static and dynamic imports.
- Supports HTTP imports through the system WebView.
- Supports [`Promise`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise) results.
- Supports an interactive [REPL](https://nodejs.org/api/repl.html).
- Supports a cached daemon for faster startup: `24.40x` faster than a cold WebView, reducing latency by `95.90%`.
- Does not support [Node.js built-in modules](https://nodejs.org/api/modules.html#built-in-modules), CommonJS, or bare package resolution directly.

## Usage

```sh
# Interactive REPL
ass

# Evaluate JavaScript
ass -e 'console.log(navigator.userAgent)'

# Print an expression result
ass -p '21 * 2'

# Evaluate TypeScript
ass --ts -p 'const answer: number = 42; answer'
ass script.ts

# Run an ES module
ass script.mjs
ass --module script.js

# Execute piped input
printf 'console.log(location.href)' | ass
```

## Daemon for better performance

Use `--reuse` to execute one-shot input in a cached WebView:

```sh
ass --reuse -p '21 * 2'
ass --reuse --ts -p 'const answer: number = 42; answer'
```

On macOS and Linux, the daemon listens on
`$TMPDIR/ass-<uid>-<version>/daemon.sock` and exits after five idle minutes. Check or control it explicitly with:

```sh
ass daemon start
ass daemon status
ass daemon stop
```

Each daemon request runs in a fresh sandboxed iframe, so JavaScript globals are not retained between requests. The interactive REPL intentionally keeps one persistent realm.

## Compiled size

Executable sizes measured from arm64 release builds on macOS:

| Runtime | Compiled size |
| --- | ---: |
| Node.js 24.14.0 | 119.13 MB |
| `ass` with TypeScript | 1.66 MB |
| `ass` without TypeScript | 0.80 MB |
| QuickJS 2026-06-04 | 0.74 MB |

These figures use decimal megabytes (`1 MB = 1,000,000 bytes`) and measure the executable itself rather than the total installed footprint. `ass` stays small by using the system WebView; Node.js and QuickJS ship their JavaScript engines in their own binaries. The QuickJS figure comes from the Homebrew arm64 bottle.

## Benchmark

End-to-end CLI execution time on an Apple M5 Max with Node.js 24.14.0:

| Runtime | Execute time | Difference vs Node.js (lower is better) |
| --- | ---: | ---: |
| Node.js (baseline) | 206.61 ms ± 20.90 ms (σ² = 436.87 ms²) | 0% |
| Cold WebView | 871.72 ms ± 124.39 ms (σ² = 15,473.84 ms²) | +321.91% |
| Reused WebView | 35.73 ms ± 5.55 ms (σ² = 30.77 ms²) | -82.71% |

Reusing the WebView is `24.40x` faster than starting a cold WebView and reduces latency by `95.90%`. The `±` value is the standard deviation (`σ`); `σ²` is the variance. Each command was warmed up three times and measured 20 times with [hyperfine](https://github.com/sharkdp/hyperfine). The commands and raw results are available in [`bench`](./bench).

## Development

Build the release binary:

```sh
cargo build --release
```

The generated WebView bridge scripts are checked in. After editing `packages/bridge/src`, rebuild them from the pnpm workspace before compiling Rust:

```sh
pnpm --filter @ass/bridge test
cargo build --release
```

The default `typescript` feature includes Oxc and enables `.ts`, `.tsx`, `.mts`, `.cts`, and `--ts`. Build a JavaScript-only binary without Oxc for the smallest release:

```sh
cargo build --release --no-default-features
```

TypeScript input reports an unsupported-feature error in that build. JavaScript, ESM, HTTP imports, the REPL, and the daemon remain available.

Linux additionally requires the WebKitGTK and GTK development packages used by wry.

## Examples

- [`examples/single`](./examples/single) runs a single TypeScript file.
- [`examples/module-import-esm`](./examples/module-import-esm) runs an unbundled local TypeScript graph with static and dynamic imports plus an esm.sh dependency.
- [`examples/bundled-tsdown`](./examples/bundled-tsdown) uses tsdown and Rolldown to bundle TypeScript and an npm dependency into one ESM file.
- [`examples/eval-import`](./examples/eval-import) imports unrtel and packages from esm.sh directly in the system WebView without a build step.

## FAQ

### Q: Why don't you use [ShadowRealm](https://github.com/tc39/proposal-shadowrealm)?

`ShadowRealm` is not used because it is not exposed by the system WKWebView tested here and remains an active TC39 proposal rather than a universally available Web API. Daemon transport on Windows is not implemented yet; it will require a named-pipe backend.

## Acknowledgements

- [Tauri](https://tauri.app/) for advancing small, system-WebView desktop applications.
- [wry](https://github.com/tauri-apps/wry) for the cross-platform WebView abstraction used by `ass`.
- [GTK](https://www.gtk.org/) and [WebKitGTK](https://webkitgtk.org/) for the Linux runtime.
- [Oxc](https://oxc.rs/) for TypeScript parsing and transformation.
- [Sucrase](https://github.com/alangpierce/sucrase) for demonstrating fast, focused TypeScript transformation.
- [Node.js](https://nodejs.org/) for its CLI and REPL conventions.
- [QuickJS](https://bellard.org/quickjs/) for its compact embeddable JavaScript runtime design.
