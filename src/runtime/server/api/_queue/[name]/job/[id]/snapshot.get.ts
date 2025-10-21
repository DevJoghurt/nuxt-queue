import { defineEventHandler, getRouterParam, $useStateProvider } from '#imports'

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name')
  const id = getRouterParam(event, 'id')
  if (!name || !id) return null
  const state = $useStateProvider()
  const snap = await state.get(`proj:job:${name}:${id}`)
  return snap || null
})
