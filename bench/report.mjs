import { readFile } from 'node:fs/promises'

const resultPath = process.argv[2] ?? new URL('./results.json', import.meta.url)
const benchmark = JSON.parse(await readFile(resultPath, 'utf8'))
const baseline = benchmark.results.find(result => result.command === 'Node.js (baseline)')

if (!baseline) {
  throw new Error('Node.js baseline is missing from the hyperfine results')
}

const milliseconds = seconds => seconds * 1_000
const formatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const format = value => formatter.format(value)

console.log('| Runtime | Execute time | Difference vs Node.js (lower is better) |')
console.log('| --- | ---: | ---: |')

for (const result of benchmark.results) {
  const median = milliseconds(result.median)
  const standardDeviation = milliseconds(result.stddev)
  const variance = standardDeviation ** 2
  const difference = (result.median / baseline.median - 1) * 100
  const differenceLabel = result === baseline
    ? '0%'
    : `${difference >= 0 ? '+' : ''}${format(difference)}%`

  console.log(
    `| ${result.command} | ${format(median)} ms ± ${format(standardDeviation)} ms (σ² = ${format(variance)} ms²) | ${differenceLabel} |`,
  )
}
