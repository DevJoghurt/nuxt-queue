import { defineEventHandler, createError } from '#imports'

export default defineEventHandler(async (_event) => {
  throw createError({ statusCode: 501, statusMessage: 'Stopping workers manually is not supported. Worker lifecycle is managed by the module.' })
})
