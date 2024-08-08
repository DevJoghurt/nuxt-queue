import { z } from 'zod'
import { JobSchemaArray } from '../../../../../schema'
import {
  defineEventHandler,
  getRouterParam,
  $useQueue,
  useRuntimeConfig,
} from '#imports'

const FilterSchema = z.enum(['active', 'completed', 'delayed', 'failed', 'paused', 'prioritized', 'waiting', 'waiting-children'])

const jobQuerySchema = z.object({
  limit: z.coerce.number().default(20),
  page: z.coerce.number().default(1),
  filter: z.union([FilterSchema, FilterSchema.array()]).transform((data) => {
    return Array.isArray(data)
      ? data
      : [data]
  }).default([]),
})

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name')
  const parsedQuery = await getValidatedQuery(event, query => jobQuerySchema.safeParse(query))

  if (!parsedQuery.success)
    throw parsedQuery.error

  const { queues } = useRuntimeConfig().queue

  if (!queues[name]) {
    throw `Queue with ${name} not found`
  }

  const { getQueue } = $useQueue()

  const queue = getQueue(name)

  const jobsCounts = await queue.getJobCounts(...parsedQuery.data.filter)
  let total = 0
  for (const jobCount in jobsCounts) {
    total = total + jobsCounts[jobCount]
  }
  const pageCount = Math.ceil(total / parsedQuery.data.limit)

  const jobs = await queue.getJobs(parsedQuery.data.filter, ((parsedQuery.data.page - 1) * parsedQuery.data.limit), ((parsedQuery.data.page - 1) * parsedQuery.data.limit) + parsedQuery.data.limit)

  for (const job of jobs) {
    job.state = await queue.getJobState(job.id)
  }

  const result = await JobSchemaArray.safeParse(jobs)
  if (result.success)
    return {
      page: parsedQuery.data.page,
      limit: parsedQuery.data.limit,
      pageCount,
      total,
      jobs: result.data,
    }
  else
    throw `Job data parsing error ${result.error}`
})
