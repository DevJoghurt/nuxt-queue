import { useRuntimeConfig } from '#imports'
import { getStreamNames } from './streamNames'
import { createRedisFallbackStreamAdapter } from './adapters/redisFallbackAdapter'
import { createRedisStreamsAdapter } from './adapters/redisStreamsAdapter'
import { createMemoryStreamAdapter } from './adapters/memoryStreamAdapter'
import { createFileStreamAdapter } from './adapters/fileStreamAdapter'
import type { StreamAdapter } from './types'

export interface StreamInstance {
  name: string
  append: StreamAdapter['append']
  read: StreamAdapter['read']
  subscribe: StreamAdapter['subscribe']
}

export interface StreamFactory {
  adapter: StreamAdapter
  names: ReturnType<typeof getStreamNames>
  stream(name: string): StreamInstance
}

let cachedFactory: StreamFactory | null = null

// Internal factory getter (no `use` prefix). Utils wrapper will expose `useStreamFactory`.
export function getStreamFactory(): StreamFactory {
  if (cachedFactory) return cachedFactory
  const rc: any = useRuntimeConfig()
  const name = rc?.queue?.eventStore?.name || 'redis'
  const mode = rc?.queue?.eventStore?.mode || 'fallback'
  let adapter: StreamAdapter
  if (name === 'memory') adapter = createMemoryStreamAdapter()
  else if (name === 'file') adapter = createFileStreamAdapter()
  else adapter = (mode === 'streams' ? createRedisStreamsAdapter() : createRedisFallbackStreamAdapter())
  const names = getStreamNames()
  const factory: StreamFactory = {
    adapter,
    names,
    stream(name: string): StreamInstance {
      return {
        name,
        append: (s, e) => adapter.append(s, e),
        read: (s, o) => adapter.read(s, o),
        subscribe: (s, cb) => adapter.subscribe(s, cb),
      }
    },
  }
  cachedFactory = factory
  return factory
}

export function setStreamFactory(f: StreamFactory) {
  cachedFactory = f
}
