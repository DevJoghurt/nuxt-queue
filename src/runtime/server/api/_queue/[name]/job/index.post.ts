import { $useQueueProvider, defineEventHandler, getRouterParam, readBody, createError } from '#imports'

// New provider-based enqueue: POST /api/_queue/:name/job
// Body: { name?: string, data?: any, opts?: any }
export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name')
  if (!name) throw createError({ statusCode: 400, statusMessage: 'Queue name is required' })
  const body = await readBody(event)
  const provider = $useQueueProvider()
  const id = await provider.enqueue(name, {
    name: body?.name || 'default',
    data: body?.data ?? {},
    opts: body?.opts,
  })
  return { id }
})
