import { defineEventHandler, createError } from '#imports'

export default defineEventHandler(async (_event) => {
  throw createError({ statusCode: 501, statusMessage: 'Resuming individual workers is not supported. Worker lifecycle is managed by the module.' })
})
