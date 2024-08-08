import {
  defineEventHandler,
  getRouterParam,
  $useQueue,
  useRuntimeConfig,
} from '#imports'

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name') || ''
  const id = getRouterParam(event, 'id') || ''

  const { queues } = useRuntimeConfig().queue

  if (!queues[name]) {
    throw `Queue with ${name} not found`
  }

  const { getQueue } = $useQueue()

  const queue = getQueue(name)

  const logs = await queue.getJobLogs(id)

  const job = await queue.getJob(id)

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
    logs: logs,
  }
})
