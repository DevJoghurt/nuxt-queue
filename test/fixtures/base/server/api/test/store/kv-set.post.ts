import { useStoreAdapter } from '#imports'

export default defineEventHandler(async (event) => {
  const store = useStoreAdapter()
  const body = await readBody(event)
  
  await store.kv.set(body.key, body.value, body.ttl)
  
  return { success: true }
})
