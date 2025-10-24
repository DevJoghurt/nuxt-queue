import z from 'zod'
import { defineEventHandler, getRouterParam, readValidatedBody, useQueue } from '#imports'

const bodySchema = z.object({
  name: z.string().regex(/^\S*$/gm).default('default'),
  scheduleType: z.enum(['every', 'cron']).default('every'),
  scheduleValue: z.any(),
  jobName: z.string().regex(/^\S*$/gm).default('default'),
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

  const { schedule } = useQueue()
  const scheduleOpts: any = {}
  if (validatedResult.data.scheduleType === 'every') {
    scheduleOpts.delay = Number.parseInt(String(validatedResult.data.scheduleValue))
  }
  if (validatedResult.data.scheduleType === 'cron') {
    scheduleOpts.cron = String(validatedResult.data.scheduleValue)
  }
  const id = await schedule(String(name), {
    name: validatedResult.data.jobName,
    data: validatedResult.data.jobData,
  }, scheduleOpts)

  return {
    statusCode: 200,
    id,
  }
})
