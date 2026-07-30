#!/bin/sh

set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
result_path="$repository_root/bench/results.json"

cd "$repository_root"

cargo build --release

./target/release/ass daemon stop >/dev/null 2>&1 || true
./target/release/ass daemon start >/dev/null

cleanup() {
  ./target/release/ass daemon stop >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

hyperfine \
  --warmup 3 \
  --runs 20 \
  --export-json "$result_path" \
  --command-name 'Node.js (baseline)' \
  "node --input-type=module --eval 'console.log(await Promise.resolve(42))'" \
  --command-name 'Cold WebView' \
  "./target/release/ass -p 'Promise.resolve(42)'" \
  --command-name 'Reused WebView' \
  "./target/release/ass --reuse -p 'Promise.resolve(42)'"

node bench/report.mjs "$result_path"
