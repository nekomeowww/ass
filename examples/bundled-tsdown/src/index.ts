import { camelCase, chunk } from 'lodash-es'

interface BundleResult {
  name: string
  chunks: number[][]
}

export const result: BundleResult = {
  name: camelCase('already shipped js'),
  chunks: chunk([1, 2, 3, 4, 5], 2),
}

console.log(`tsdown bundle: ${JSON.stringify(result)}`)
