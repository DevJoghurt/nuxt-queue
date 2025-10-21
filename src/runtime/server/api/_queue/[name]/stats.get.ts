import { defineEventHandler, getRouterParam, $useStateProvider } from '#imports'

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name')
  if (!name) return null
  const state = $useStateProvider()
  const stats = await state.get(`proj:queue:${name}`)
  return stats || {}
})
