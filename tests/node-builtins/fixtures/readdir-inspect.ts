import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'

const directory = '.ass-readdir-inspect'
try {
  await mkdir(directory, { recursive: true })
  await writeFile(`${directory}/c.txt`, '')
  await writeFile(`${directory}/a.txt`, '')
  await writeFile(`${directory}/b.txt`, '')
  console.log(await readdir(directory))
}
finally {
  await rm(directory, { force: true, recursive: true })
}
