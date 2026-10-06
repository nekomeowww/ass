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
