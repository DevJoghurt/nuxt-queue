import { useRuntimeConfig } from '#imports'
import { getStreamNames } from './streamNames'
import { createRedisFallbackStreamAdapter } from './adapters/redisFallbackAdapter'
import { createRedisStreamsAdapter } from './adapters/redisStreamsAdapter'
import { createMemoryStreamAdapter } from './adapters/memoryStreamAdapter'
import { createFileStreamAdapter } from './adapters/fileStreamAdapter'
import type { StreamAdapter } from './types'
// import { getEventBus } from '../events/eventBus'
import { createWiringRegistry } from './wiring/registry'

export interface StreamStoreInstance {
  name: string
  append: StreamAdapter['append']
  read: StreamAdapter['read']
  subscribe: StreamAdapter['subscribe']
}

export interface StreamStoreFactory {
  adapter: StreamAdapter
  names: ReturnType<typeof getStreamNames>
  stream(name: string): StreamStoreInstance
  /** Idempotently start stream store wiring that persists ingress events and projections */
  start(): void
  /** Stop wiring and release listeners */
  stop(): void
}

let cachedFactory: StreamStoreFactory | null = null

// Internal factory getter (no `use` prefix). Utils wrapper will expose `useStreamStoreFactory`.
export function getStreamStoreFactory(): StreamStoreFactory {
  if (cachedFactory) return cachedFactory
  const rc: any = useRuntimeConfig()
  const name = rc?.queue?.eventStore?.name || 'redis'
  const mode = rc?.queue?.eventStore?.mode || 'fallback'
  let adapter: StreamAdapter
  if (name === 'memory') adapter = createMemoryStreamAdapter()
  else if (name === 'file') adapter = createFileStreamAdapter()
  else adapter = (mode === 'streams' ? createRedisStreamsAdapter() : createRedisFallbackStreamAdapter())

  // Debug logging
  if (process.env.NQ_DEBUG_EVENTS === '1') {
    console.log('[stream-store-factory] initialized', { name, mode, adapterType: mode === 'streams' ? 'redis-streams' : 'fallback' })
  }

  const names = getStreamNames()
  // v0.3: Wiring registry with simplified flow wiring
  const wiring = createWiringRegistry({ adapter, names: names as any })

  const factory: StreamStoreFactory = {
    adapter,
    names,
    stream(name: string): StreamStoreInstance {
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

export function setStreamStoreFactory(f: StreamStoreFactory) {
  cachedFactory = f
}
