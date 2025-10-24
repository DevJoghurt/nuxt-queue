import { defineNitroPlugin } from '#imports'
import type { EventRecord } from '../streams/types'
import { getEventBus } from '../streams/eventBus'
import { getStreamFactory } from '../streams/streamFactory'

export default defineNitroPlugin(() => {
  // Mirror events from the adapter's global stream into the in-proc bus only.
  // Important: do NOT republish to the adapter to avoid infinite loops.
  const factory = getStreamFactory()
  const bus = getEventBus()
  const subs: Array<{ unsubscribe(): void }> = []

  const start = async () => {
    // Mirror the adapter global stream into the in-proc bus so in-process listeners see external events.
    const sub = await factory.adapter.subscribe(factory.names.global, (e: EventRecord) => {
      try {
        bus.publish(e)
      }
      catch {
        // ignore
      }
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
        // adapter close handled by Nitro shutdown hooks elsewhere if needed
      },
    },
  }
})
