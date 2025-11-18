import { useStoreAdapter } from '#imports'

export default defineEventHandler(async (event) => {
  const store = useStoreAdapter()
  const query = getQuery(event)
  
  const value = await store.kv.get(query.key as string)
  
  return { value }
})
