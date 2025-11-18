import { useQueueAdapter } from '#imports'

export default defineEventHandler(async (event) => {
  const queue = useQueueAdapter()
  const query = getQuery(event)
  
  const queueName = query.queue as string
  const filter = query.filter ? (Array.isArray(query.filter) ? query.filter : [query.filter]) : ['waiting', 'active', 'completed']
  const limit = query.limit ? Number(query.limit) : 100

  const jobs = await queue.getJobs(queueName, { filter: filter as any, limit })
  
  return { jobs }
})
