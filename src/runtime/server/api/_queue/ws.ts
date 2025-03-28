import type { Peer } from 'crossws'
import { getQuery } from 'ufo'
import { $useQueue } from '../../utils/useQueue'
import {
  defineWebSocketHandler,
} from '#imports'

function getQueueId(peer: Peer) {
  const query = getQuery(peer.request?.url || '')
  return query.id as string
}

export default defineWebSocketHandler({
  open(peer) {
    console.log(`[ws] open ${peer}`)

    const queueId = getQueueId(peer)

    const { addListener } = $useQueue()

    addListener(queueId, peer)
  },

  message(peer, message) {
    console.log('[ws] message', peer, message)
  },

  close(peer) {
    console.log('[ws] close', peer.id)

    const queueId = getQueueId(peer)

    const { removeListener } = $useQueue()

    removeListener(queueId, peer)
  },

  error(peer, error) {
    console.log('[ws] error', peer, error)
  },
})
