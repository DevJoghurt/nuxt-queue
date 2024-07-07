import { 
  defineWebSocketHandler,
  $useQueue
} from '#imports'
import type { Peer } from "crossws"
import { getQuery } from "ufo"

function getQueueId(peer: Peer) {
  const query = getQuery(peer.url)
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
      console.log("[ws] message", peer, message)
    },
  
    close(peer, event) {
      console.log("[ws] close", peer, event)

      const queueId = getQueueId(peer)

      const { removeListener } = $useQueue()

      removeListener(queueId, peer)
    },
  
    error(peer, error) {
      console.log("[ws] error", peer, error)
    },
});