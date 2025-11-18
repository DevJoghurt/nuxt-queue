import { useStoreAdapter } from '#imports'

export default defineEventHandler(async (event) => {
  const store = useStoreAdapter()
  const query = getQuery(event)
  
  const subject = query.subject as string
  const opts = query.limit ? { limit: Number(query.limit) } : undefined
  
  const events = await store.read(subject, opts)
  
  return { events }
})
