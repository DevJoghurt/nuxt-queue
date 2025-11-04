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
  const name = rc?.queue?.eventStore?.name || 'memory'

  let adapter: EventStoreAdapter
  if (name === 'memory') adapter = createMemoryAdapter()
  else if (name === 'file') adapter = createFileAdapter()
  else if (name === 'redis') adapter = createRedisAdapter()
  else adapter = createMemoryAdapter() // fallback to memory

  // Debug logging
  if (process.env.NQ_DEBUG_EVENTS === '1') {
    console.log('[stream-store-factory] initialized', { name, adapterType: name })
  }

  const names = getStreamNames()
  // v0.3: Wiring registry with simplified flow wiring
  const wiring = createWiringRegistry({ adapter, names: names as any })

  const factory: EventStoreFactory = {
    adapter,
    names,
    stream(name: string): EventStoreInstance {
      return {
        name,
        append: (s, e) => adapter.append(s, e),
        read: (s, o) => adapter.read(s, o),
        subscribe: (s, cb) => adapter.subscribe(s, cb),
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
