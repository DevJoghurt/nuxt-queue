import { defineNitroPlugin, $useEventStoreProvider, $useEventBus, $useStreamNames } from '#imports'

export default defineNitroPlugin(() => {
  const { publish } = $useEventBus()
  const streams = $useStreamNames()
  const store = $useEventStoreProvider()
  const subs: Array<{ unsubscribe(): void }> = []

  const start = async () => {
    // At minimum, mirror global stream into the in-proc bus so WS clients get cross-process events
    const sub = await store.subscribe(streams.global, (e) => {
      publish(e)
    })
    subs.push(sub)
  }

  start().catch(() => {})

  return {
    hooks: {
      close: async () => {
        for (const s of subs) {
          try {
            s.unsubscribe()
          }
          catch {
            // ignore
          }
        }
        subs.length = 0
        try {
          await store.close()
        }
        catch {
          // ignore
        }
      },
    },
  }
})
