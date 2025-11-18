import { useQueueAdapter } from '#imports'

export default defineEventHandler(async (event) => {
  const queue = useQueueAdapter()
  const body = await readBody(event)

  const jobId = await queue.enqueue(body.queue, {
    name: body.name,
    data: body.data,
    opts: body.opts,
  })

  return { jobId }
})
