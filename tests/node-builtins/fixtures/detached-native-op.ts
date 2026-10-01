import { readFile } from 'node:fs/promises'

async function main() {
  const source = await readFile('./Cargo.toml', 'utf8')
  console.log(source.includes('name = "ass"'))
}

main().catch(console.error)
