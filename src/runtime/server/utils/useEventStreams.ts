import { useStreamStore, useRuntimeConfig } from '#imports'
import type { EventRecord } from '../../types'
import IORedis from 'ioredis'

/**
 * v0.4 Event Stream Utilities
 *
 * Provides methods for working with the runId-based event architecture:
 * - Reading events from streams (nq:flow:{runId})
 * - Subscribing to streams
 * - Querying sorted set indexes (nq:flows:{flowName})
 */

export interface ListItem {
  id: string
  timestamp: number
  createdAt: string
}

/**
 * Get Redis connection (cached)
 */
let _redis: IORedis | null = null
function getRedis(): IORedis {
  if (!_redis) {
    const rc: any = useRuntimeConfig()
    const conn = rc?.queue?.redis || {}
    _redis = new IORedis({
      host: conn.host,
      port: conn.port,
      username: conn.username,
      password: conn.password,
      lazyConnect: true,
    })
  }
  return _redis
}

export function useEventStreams() {
  const store = useStreamStore()
  const rc: any = useRuntimeConfig()
  const DEBUG = rc?.queue?.debug?.events || process.env.NQ_DEBUG_EVENTS === '1'

  /**
   * Read events from a flow stream (v0.4: nq:flow:{runId})
   * @param type - Should be 'flow' for flow streams
   * @param id - The runId (flow execution ID)
   */
  async function readEvents(
    type: string,
    id: string,
    opts?: { limit?: number, fromId?: string, direction?: 'forward' | 'backward' },
  ): Promise<EventRecord[]> {
    const subject = `nq:${type}:${id}`
    const events = await store.adapter.read(subject, {
      limit: opts?.limit || 100,
      fromId: opts?.fromId,
      direction: opts?.direction || 'forward',
    })

    if (DEBUG) {
      console.log('[event-streams] read events', { type, id, count: events.length })
    }

    return events as EventRecord[]
  }

  /**
   * Subscribe to a flow stream (v0.4: nq:flow:{runId})
   * @param type - Should be 'flow' for flow streams
   * @param id - The runId (flow execution ID)
   */
  async function subscribeToStream(
    type: string,
    id: string,
    handler: (event: EventRecord) => void,
  ): Promise<{ unsubscribe: () => void }> {
    const subject = `nq:${type}:${id}`
    const subscription = await store.adapter.subscribe(subject, handler as any)

    if (DEBUG) {
      console.log('[event-streams] subscribed', { type, id, subject })
    }

    return subscription
  }

  /**
   * List flow runs from sorted set index (v0.4: nq:flows:{flowName})
   * @param type - Should be 'flow' for flows
   * @param name - The flow name (e.g., 'example-flow')
   */
  async function listItems(
    type: string,
    name?: string,
    opts?: { limit?: number },
  ): Promise<ListItem[]> {
    const redis = getRedis()
    const limit = Math.min(opts?.limit || 50, 100)

    try {
      if (!redis.status || redis.status === 'end') {
        await redis.connect()
      }

      // Index key: nq:flows:example-flow or nq:triggers
      const indexKey = name ? `nq:${type}s:${name}` : `nq:${type}s`

      if (DEBUG) {
        console.log('[event-streams] listing items', { indexKey, limit })
      }

      // Get items from sorted set (most recent first)
      const items = await redis.zrevrange(indexKey, 0, limit - 1, 'WITHSCORES')

      // Parse results (alternating: member, score, member, score, ...)
      const results: ListItem[] = []
      for (let i = 0; i < items.length; i += 2) {
        const timestamp = Number.parseInt(items[i + 1])
        results.push({
          id: items[i],
          timestamp,
          createdAt: new Date(timestamp).toISOString(),
        })
      }

      if (DEBUG) {
        console.log('[event-streams] found items', { indexKey, count: results.length })
      }

      return results
    }
    catch (err) {
      console.error('[event-streams] error listing items:', err)
      throw err
    }
  }

  /**
   * Add flow run to sorted set index (v0.4: nq:flows:{flowName})
   * @param type - Should be 'flow' for flows
   * @param name - The flow name (e.g., 'example-flow')
   * @param id - The runId (flow execution ID)
   * @param timestamp - Unix timestamp in milliseconds
   */
  async function addToIndex(
    type: string,
    name: string,
    id: string,
    timestamp: number,
  ): Promise<void> {
    const redis = getRedis()

    try {
      if (!redis.status || redis.status === 'end') {
        await redis.connect()
      }

      const indexKey = `nq:${type}s:${name}`
      await redis.zadd(indexKey, timestamp, id)

      if (DEBUG) {
        console.log('[event-streams] added to index', { indexKey, id, timestamp })
      }
    }
    catch (err) {
      console.error('[event-streams] error adding to index:', err)
      throw err
    }
  }

  return {
    readEvents,
    subscribeToStream,
    listItems,
    addToIndex,
  }
}

export default useEventStreams
