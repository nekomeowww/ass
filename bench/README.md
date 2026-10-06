# Benchmark

The benchmark compares the end-to-end process execution time for resolving and printing the same
Promise in Node.js, a cold system WebView, and the reusable WebView daemon.

It performs three warmup runs followed by 20 measured runs per command. The report displays the
median, standard deviation (`σ`), variance (`σ²`), and the difference from the Node.js median.

```sh
./bench/run.sh
```

Raw hyperfine output is written to `bench/results.json`. Regenerate it on the target machine rather
than comparing result files produced on different hardware.

The results checked in on October 7, 2026 were measured on an Apple M5 Max (arm64), macOS 26.3,
with Node.js 26.7.0, Rust 1.96.1, and hyperfine 1.20.0. The benchmark uses the default
TypeScript-enabled release build. Hyperfine reported outliers for the cold WebView; all samples
are retained.

Release executable sizes were also measured locally with `stat -f %z` after
`cargo build --release --no-default-features` (1,979,488 bytes) and
`cargo build --release` (2,812,480 bytes). The README's comparison sizes were rechecked against
the Node.js 24.14.0 arm64 executable (119,133,456 bytes) and the cached Homebrew QuickJS
2026-06-04 arm64 bottle's `bin/qjs` (741,440 bytes). The Node.js size reference differs from
the benchmark version: the installed Homebrew Node.js 26.7.0 uses a separate shared library.
