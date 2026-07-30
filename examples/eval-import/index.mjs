import { evaluate } from 'https://esm.sh/@unrteljs/eval@0.2.1/browser'

const result = await evaluate(`
  import { camelCase } from 'lodash-es@4.17.21'
  import { format } from 'date-fns@4.1.0'

  return JSON.stringify({
    name: camelCase('already shipped js'),
    date: format(new Date('2026-07-30T00:00:00Z'), 'yyyy-MM-dd'),
  })
`)

console.log(`unrtel + esm.sh: ${result}`)

export default result
