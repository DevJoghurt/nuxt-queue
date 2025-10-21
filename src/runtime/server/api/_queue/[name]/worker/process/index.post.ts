import { defineEventHandler, createError } from '#imports'

export default defineEventHandler(async (_event) => {
  throw createError({ statusCode: 501, statusMessage: 'Worker process control is managed by the module; manual start is not supported.' })
})
