import { defineEventHandler, getRouterParam, $useStateProvider } from '#imports'

export default defineEventHandler(async (event) => {
  const flowId = getRouterParam(event, 'id')
  if (!flowId) return []
  const state = $useStateProvider()
  const prefix = `flowrun:${flowId}:`
  const { keys } = await state.list(prefix)
  const items = await Promise.all(keys.map(async (k: string) => {
    try {
      const it = await state.get<any>(k)
      return it
    }
    catch {
      return null
    }
  }))
  return items.filter(Boolean)
})
