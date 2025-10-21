import { defineEventHandler, createError } from '#imports'

export default defineEventHandler(async (_event) => {
  throw createError({ statusCode: 501, statusMessage: 'Worker instance details are not supported. Worker lifecycle is managed by the module.' })
})
