import z from 'zod'
import { defineEventHandler, getRouterParam, readValidatedBody, $useQueue } from '#imports'

const bodySchema = z.object({
  name: z.string().default('default'),
  scheduleType: z.enum(['every', 'cron']).default('every'),
  scheduleValue: z.any(),
  jobName: z.string().default('default'),
  jobData: z.string().default('{}').transform((data) => {
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

  const { getQueue } = $useQueue()

  const queue = getQueue(name)

  const schedule = {} as any

  if (validatedResult.data.scheduleType === 'every') {
    schedule.every = Number.parseInt(validatedResult.data.scheduleValue)
  }
  if (validatedResult.data.scheduleType === 'cron') {
    schedule.cron = validatedResult.data.scheduleValue
  }

  queue.upsertJobScheduler(validatedResult.data.name, schedule, {
    name: validatedResult.data.jobName,
    data: validatedResult.data.jobData,
  })

  return {
    statusCode: 200,
  }
})
