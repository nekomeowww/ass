import { add } from './math.ts'
import { camelCase } from 'https://esm.sh/lodash-es@4.17.21'

const { runtimeLabel } = await import('./runtime-label.mjs')

interface Result {
  answer: number
  name: string
  runtime: string
}

const result: Result = {
  answer: add(20, 22),
  name: camelCase('already shipped modules'),
  runtime: runtimeLabel,
}

console.log(`multi-file esm: ${JSON.stringify(result)}`)

export default result
