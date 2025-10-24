import { defineEventHandler, getRouterParam, useQueue, createError } from '#imports'

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name')
  if (!name) throw createError({ statusCode: 400, statusMessage: 'Queue name is required' })
  const { resume } = useQueue()
  await resume(name)
  return { ok: true }
})
