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

      const { getQueueEvents } = $useQueue()

      const eventBus = getQueueEvents(queueId)

      if(!eventBus) return

      eventBus.on('completed', ({jobId, returnvalue, prev}) => {
        peer.send({
          eventType: 'completed',
          job: {
            id: jobId,
            returnvalue,
            prev
          }
        })
      })

      eventBus.on('active', ({jobId, prev}) => {
        peer.send({
          eventType: 'active',
          job: {
            id: jobId,
            prev
          }
        })
      })

      eventBus.on('progress', ({ jobId, data}) => {
        peer.send({
          eventType: 'progress',
          job: {
            id: jobId,
            progress: data
          }
        })
      })

      eventBus.on('added', ({ jobId, name}) => {
        peer.send({
          eventType: 'added',
          job: {
            id: jobId,
            name
          }
        })
      })

      eventBus.on('waiting', ({ jobId, prev}) => {
        peer.send({
          eventType: 'added',
          job: {
            id: jobId,
            prev
          }
        })
      })

      eventBus.on('failed', ({ jobId, failedReason, prev}) => {
        peer.send({
          eventType: 'added',
          job: {
            id: jobId,
            prev,
            failedReason
          }
        })
      })
    },
  
    message(peer, message) {
      console.log("[ws] message", peer, message)
    },
  
    close(peer, event) {
      console.log("[ws] close", peer, event)
    },
  
    error(peer, error) {
      console.log("[ws] error", peer, error)
    },
});