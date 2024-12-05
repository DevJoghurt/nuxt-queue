import z from 'zod'
import { $useQueue } from '#imports'
import {
  defineEventHandler,
  getRouterParam,
  useRuntimeConfig,
  readValidatedBody,
} from '#imports'

const bodySchema = z.object({
  name: z.string().default('default'),
  data: z.string().default('{}').transform((data) => {
    return JSON.parse(data)
  }),
})

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name')

  if (!name) {
    throw 'Queue name is required'
  }

  const validatedResult = await readValidatedBody(event, bodySchema.safeParse)
  if (!validatedResult.success) {
    throw validatedResult.error
  }

  const newJob = validatedResult.data

  console.log(newJob)

  const { queues } = useRuntimeConfig().queue

  if (!queues[name]) {
    throw `Queue with ${name} not found`
  }

  const { getQueue } = $useQueue()

  const queue = getQueue(name)

  const job = await queue.add(newJob.name, newJob.data)

  return {
    id: job?.id || '',
    name: job?.name || '',
    queue: queue.name,
    data: job?.data || {},
    delay: job?.delay || 0,
    progress: job?.progress || 0,
    timestamp: job?.timestamp || 0,
    finishedOn: job?.finishedOn || null,
    processedOn: job?.processedOn || null,
    attemptsStarted: job?.attemptsStarted || 0,
    attemptsMade: job?.attemptsMade || 0,
    stacktrace: job?.stacktrace || [],
    returnvalue: job?.returnvalue || null,
    options: job?.opts || {},
    logs: [],
  }
})
