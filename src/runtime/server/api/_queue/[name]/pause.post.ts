import { defineEventHandler, getRouterParam, $useQueueProvider, createError } from '#imports'

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name')
  if (!name) throw createError({ statusCode: 400, statusMessage: 'Queue name is required' })
  const provider = $useQueueProvider()
  await provider.pause(name)
  return { ok: true }
})
