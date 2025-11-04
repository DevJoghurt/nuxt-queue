import { useRuntimeConfig } from '#imports'
import { getStreamNames } from './streamNames'
import { createRedisAdapter } from './adapters/redis/redisAdapter'
import { createMemoryAdapter } from './adapters/memoryAdapter'
import { createFileAdapter } from './adapters/fileAdapter'
import type { EventStoreAdapter } from './types'
import { createWiringRegistry } from './wiring/registry'

export interface EventStoreInstance {
  name: string
  append: EventStoreAdapter['append']
  read: EventStoreAdapter['read']
  subscribe: EventStoreAdapter['subscribe']
}

export interface EventStoreFactory {
  adapter: EventStoreAdapter
  names: ReturnType<typeof getStreamNames>
  stream(name: string): EventStoreInstance
  /** Idempotently start stream store wiring that persists ingress events and projections */
  start(): void
  /** Stop wiring and release listeners */
  stop(): void
}

let cachedFactory: EventStoreFactory | null = null

// Internal factory getter (no `use` prefix). Utils wrapper will expose `useEventStoreFactory`.
export function getEventStoreFactory(): EventStoreFactory {
  if (cachedFactory) return cachedFactory
  const rc: any = useRuntimeConfig()
  const adapter = rc?.queue?.eventStore?.adapter || 'memory'

  let adapterInstance: EventStoreAdapter
  if (adapter === 'memory') adapterInstance = createMemoryAdapter()
  else if (adapter === 'file') adapterInstance = createFileAdapter()
  else if (adapter === 'redis') adapterInstance = createRedisAdapter()
  else adapterInstance = createMemoryAdapter() // fallback to memory

  // Debug logging
  if (process.env.NQ_DEBUG_EVENTS === '1') {
    console.log('[stream-store-factory] initialized', { adapter, adapterType: adapter })
  }

  const names = getStreamNames()
  // v0.3: Wiring registry with simplified flow wiring
  const wiring = createWiringRegistry({ adapter: adapterInstance, names: names as any })

  const factory: EventStoreFactory = {
    adapter: adapterInstance,
    names,
    stream(name: string): EventStoreInstance {
      return {
        name,
        append: (s, e) => adapterInstance.append(s, e),
        read: (s, o) => adapterInstance.read(s, o),
        subscribe: (s, cb) => adapterInstance.subscribe(s, cb),
      }
    },
    start(): void {
      wiring.start()
    },
    stop(): void {
      wiring.stop()
    },
  }
  cachedFactory = factory
  return factory
}

export function setEventStoreFactory(f: EventStoreFactory) {
  cachedFactory = f
}
