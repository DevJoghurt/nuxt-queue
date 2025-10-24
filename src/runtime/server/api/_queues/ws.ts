import type { Peer } from 'crossws'
import { getQuery } from 'ufo'
import { defineWebSocketHandler, useQueue } from '#imports'

function getQueueId(peer: Peer) {
  const query = getQuery(peer.request?.url || '')
  return query.id as string
}

export default defineWebSocketHandler({
  open(peer) {
    console.log(`[ws] open ${peer}`)

    const queueId = getQueueId(peer)
    const { on } = useQueue()
    const events: Array<Parameters<typeof on>[1]> = ['added', 'waiting', 'active', 'progress', 'completed', 'failed']
    const unsubs = events.map(e => on(queueId, e as any, (msg: any) => {
      try {
        peer.send(JSON.stringify({ eventType: e, message: msg }))
      }
      catch (err) {
        console.error('[ws] send error', err)
      }
    }))
    // stash unsubscribes on peer for cleanup
    // @ts-expect-error augmenting peer at runtime
    peer.__nuxtQueueUnsubs = unsubs
  },

  message(peer, message) {
    console.log('[ws] message', peer, message)
  },

  close(peer) {
    console.log('[ws] close', peer.id)

    const unsubs: Array<() => void> = (peer as any).__nuxtQueueUnsubs || []
    for (const u of unsubs) {
      try {
        u()
      }
      catch {
        // ignore
      }
    }
    delete (peer as any).__nuxtQueueUnsubs
  },

  error(peer, error) {
    console.log('[ws] error', peer, error)
  },
})
