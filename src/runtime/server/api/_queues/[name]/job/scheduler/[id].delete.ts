import { defineEventHandler, createError } from '#imports'

export default defineEventHandler(async () => {
  throw createError({ statusCode: 501, statusMessage: 'Removing schedulers is not implemented in the provider-agnostic API' })
})
