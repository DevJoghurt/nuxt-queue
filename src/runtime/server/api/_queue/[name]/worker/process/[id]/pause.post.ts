import { defineEventHandler, createError } from '#imports'

export default defineEventHandler(async (_event) => {
  throw createError({ statusCode: 501, statusMessage: 'Pausing individual workers is not supported. Control at queue level via provider if needed.' })
})
