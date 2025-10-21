import { useRuntimeConfig } from '#imports'
import type { EventStoreProvider } from './contracts'
import { createRedisEventStore } from './redis'
import { createRedisStreamsEventStore } from './redis-streams'
import { createMemoryEventStore } from './memory'

let current: EventStoreProvider | null = null

export function useEventStoreProvider(): EventStoreProvider {
  if (current) return current as EventStoreProvider
  const rc: any = useRuntimeConfig()
  const name = rc?.queue?.eventStore?.name || 'redis'
  const mode = rc?.queue?.eventStore?.mode || 'fallback' // 'streams' | 'fallback'
  if (name === 'redis') {
    current = mode === 'streams' ? createRedisStreamsEventStore() : createRedisEventStore()
    return current
  }
  if (name === 'memory') {
    current = createMemoryEventStore()
    return current
  }
  throw new Error(`[nuxt-queue] Unsupported EventStore provider: ${name}`)
}

export function setEventStoreProvider(p: EventStoreProvider) {
  current = p
}
