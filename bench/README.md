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

For reusable CLI latency, binary file reads, and Buffer Base64 conversion:

```sh
pnpm run build
cargo build --release
node bench/io.mjs
# Optionally compare a saved binary from before a change:
node bench/io.mjs /absolute/path/to/previous-ass
```

This benchmark starts its own daemon in an isolated temporary directory and removes its fixture
on exit. It prints JSON with 20 samples after three warmups for each case. CLI latency includes
process startup; file reads and conversions measure only the operation inside JavaScript, with
warm filesystem caches. WebView timer precision may round sub-millisecond results to zero.

Local comparison on 2026-10-07 (Apple M5 Max, macOS 26.3), against the release binary at
`e8ebb9f657daa72e91e4a9eb4534926a123e8412`, using `io.mjs` with both binaries:

| Operation | Before, median | After, median |
| --- | ---: | ---: |
| Reused CLI execution | 24.4 ms | 7.3 ms |
| Read 8 MiB into Buffer | 91 ms | 2.5 ms |
| Decode 8 MiB from Base64 | 66 ms | 1 ms |
| Encode 8 MiB as Base64 | 83 ms | below the 1 ms timer resolution |

The changes use readiness-driven daemon acceptance without a preliminary Ping, binary file
responses with transferable ArrayBuffers, and native typed-array Base64 methods when available.
Older WebViews retain a conversion fallback. These figures are local measurements, not
cross-platform guarantees; release compiler optimization settings are unchanged.
