import { promises } from '@ass/node-builtin-modules/stream'

export const finished = promises.finished
export const pipeline = promises.pipeline
export default { finished, pipeline }
