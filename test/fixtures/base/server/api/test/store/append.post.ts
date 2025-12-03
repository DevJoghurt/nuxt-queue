import { useStoreAdapter } from '#imports'

export default defineEventHandler(async (event) => {
  const store = useStoreAdapter()
  const body = await readBody(event)

  await store.append(body.subject, body.event)

  return { success: true }
})
