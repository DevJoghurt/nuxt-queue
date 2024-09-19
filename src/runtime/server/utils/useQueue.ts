import { consola } from 'consola'
import { Queue, QueueEvents } from 'bullmq'
import type {
  ConnectionOptions,
  QueueEventsOptions,
  QueueOptions,
  RedisOptions,
} from 'bullmq'
import type { Peer } from 'crossws'
import { useRuntimeConfig } from '#imports'

type EventInstance = {
  peers: Peer[]
  queueEvents: QueueEvents
}

const queues: Queue[] = []
const eventInstances: EventInstance[] = []

export const $useQueue = () => {
  const { redis: {
    host,
    port,
  } } = useRuntimeConfig().queue
  const logger = consola.create({}).withTag('QUEUE')

  const redisOptions: RedisOptions = {
    host,
    port,
    retryStrategy: function (times: number) {
      return Math.max(Math.min(Math.exp(times), 20000), 1000)
    },
  }

  const connectionOptions: ConnectionOptions = {
    host,
    port,
  }

  /**
   * Initilizes a queue. If queue is already initialized, it will return undefined but log a warning.
   *
   * @param name Name of the queue
   */
  const initQueue = (
    name: string,
    opts?: Omit<QueueOptions, 'connection'>,
  ) => {
    // check if queue already exists
    if (queues.find(queue => queue.name === name)) {
      logger.warn(`Queue ${name} already exists`)
      return
    }
    const defaultConnectionOptions: ConnectionOptions = {
      enableOfflineQueue: false,
    }

    const queue = new Queue(name, {
      connection: {
        ...redisOptions,
        ...defaultConnectionOptions,
      },
      ...opts,
    })

    queues.push(queue)

    logger.success(`Queue ${name} initialized`)

    return queue
  }

  /**
   * Returns the a queue by name. If queue is not found, it will return undefined but log a warning.
   *
   * @param name Name of the queue
   */
  const getQueue = (name: string) => {
    const queue = queues.find(queue => queue.name === name)!

    if (!queue) {
      logger.warn(`Queue ${name} not found`)
    }

    return queue
  }

  const getQueues = () => {
    return queues
  }

  const addListener = (queueId: string, peer: Peer) => {
    const eventInstance = eventInstances.find(eventInstance => eventInstance.queueEvents.name === queueId)
    if (eventInstance) {
      if (eventInstance.peers.length === 0) {
        eventInstance.queueEvents.on('completed', ({ jobId, returnvalue, prev }) => {
          for (const peer of eventInstance.peers) {
            peer.send({
              eventType: 'completed',
              job: {
                id: jobId,
                returnvalue,
                prev,
              },
            })
          }
        })

        eventInstance.queueEvents.on('active', ({ jobId, prev }) => {
          for (const peer of eventInstance.peers) {
            peer.send({
              eventType: 'active',
              job: {
                id: jobId,
                prev,
              },
            })
          }
        })

        eventInstance.queueEvents.on('progress', ({ jobId, data }) => {
          for (const peer of eventInstance.peers) {
            peer.send({
              eventType: 'progress',
              job: {
                id: jobId,
                progress: data,
              },
            })
          }
        })

        eventInstance.queueEvents.on('added', ({ jobId, name }) => {
          for (const peer of eventInstance.peers) {
            peer.send({
              eventType: 'added',
              job: {
                id: jobId,
                name,
              },
            })
          }
        })

        eventInstance.queueEvents.on('waiting', ({ jobId, prev }) => {
          for (const peer of eventInstance.peers) {
            peer.send({
              eventType: 'waiting',
              job: {
                id: jobId,
                prev,
              },
            })
          }
        })

        eventInstance.queueEvents.on('failed', ({ jobId, failedReason, prev }) => {
          peer.send({
            eventType: 'failed',
            job: {
              id: jobId,
              prev,
              failedReason,
            },
          })
        })
      }

      eventInstance.peers.push(peer)
    }
  }

  const removeListener = (queueId: string, peer: Peer) => {
    const eventInstance = eventInstances.find(eventInstance => eventInstance.queueEvents.name === queueId)
    if (eventInstance) {
      // find peer and remove it
      const index = eventInstance.peers.findIndex(p => p.id === peer.id)
      if (index > -1) eventInstance.peers.splice(index, 1)
      if (eventInstance.peers.length === 0) eventInstance.queueEvents.removeAllListeners()
    }
  }

  /**
   * Initilizes a queueEvent. If queueEvent is already initialized, it will return undefined but log a warning.
   *
   * @param name Name of the queue
   */
  const initQueueEvent = (
    name: string,
    opts?: Omit<QueueEventsOptions, 'connection'>,
  ) => {
    // check if queueEvent already exists
    if (eventInstances.find(eventInstance => eventInstance.queueEvents.name === name)) {
      logger.warn(`QueueEvent ${name} already exists`)
      return
    }
    const defaultConnectionOptions: ConnectionOptions = {
      enableOfflineQueue: false,
    }

    const queueEvents = new QueueEvents(name, {
      connection: {
        ...redisOptions,
        ...defaultConnectionOptions,
      },
      ...opts,
    })

    eventInstances.push({
      peers: [],
      queueEvents,
    })

    logger.success(`QueueEvent Instance ${name} initialized`)
    return eventInstances
  }

  /**
   * Returns the a QueueEvents Instance by name. If QueueEvents Instance is not found, it will return undefined but log a warning.
   *
   * @param name Name of the queue
   */
  const getQueueEvents = (name: string) => {
    const eventInstance = eventInstances.find(eventInstance => eventInstance.queueEvents.name === name)!

    if (!eventInstance) {
      logger.warn(`QueueEvent ${name} not found`)
    }

    return eventInstance
  }

  const disconnect = async () => {
    for (const eventInstance of eventInstances) {
      eventInstance.peers = []
      await eventInstance.queueEvents.removeAllListeners()
    }
  }

  return {
    initQueue,
    initQueueEvent,
    getQueue,
    getQueueEvents,
    disconnect,
    getQueues,
    addListener,
    removeListener,
    connectionOptions,
  }
}
