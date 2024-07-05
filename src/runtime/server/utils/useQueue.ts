import { useRuntimeConfig } from "#imports"
import { consola } from "consola"
import { Queue, QueueEvents, QueueEventsListener } from "bullmq"
import type {
    ConnectionOptions,
    QueueEventsOptions,
    QueueOptions,
    RedisOptions
  } from "bullmq"


const queues: Queue[] = []
const queueEvents: QueueEvents[] = []

export const $useQueue = () => {
    const { redis: {
        host,
        port
    } } = useRuntimeConfig().queue
    const logger = consola.create({}).withTag("QUEUE")

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
        opts?: Omit<QueueOptions, "connection">
    ) => {
        // check if queue already exists
        if (queues.find((queue) => queue.name === name)) {
            logger.warn(`Queue ${name} already exists`)
            return
        }
        const defaultConnectionOptions: ConnectionOptions = {
            enableOfflineQueue: false,
        }
    
        const queue = new Queue(name, {
            connection: { 
                ...redisOptions, 
                ...defaultConnectionOptions 
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
        const queue = queues.find((queue) => queue.name === name)!

        if (!queue) {
        logger.warn(`Queue ${name} not found`);
        }

        return queue
    }
    
    const getQueues = () => {
        return queues
    }

    /**
     * Initilizes a queueEvent. If queueEvent is already initialized, it will return undefined but log a warning.
     *
     * @param name Name of the queue
     */
    const initQueueEvent = (
        name: string,
        opts?: Omit<QueueEventsOptions, "connection">
    ) => {
        // check if queueEvent already exists
        if (queueEvents.find((queue) => queue.name === name)) {
            logger.warn(`QueueEvent ${name} already exists`)
        return
        }
        const defaultConnectionOptions: ConnectionOptions = {
            enableOfflineQueue: false,
        }
    
        const queueEvent = new QueueEvents(name, {
            connection: { 
                ...redisOptions, 
                ...defaultConnectionOptions 
            },
            ...opts,
        })
    
        queueEvents.push(queueEvent)

        logger.success(`QueueEvent Instance ${name} initialized`)
        return queueEvents
    }

    /**
     * Returns the a QueueEvents Instance by name. If QueueEvents Instance is not found, it will return undefined but log a warning.
     *
     * @param name Name of the queue
     */
    const getQueueEvents = (name: string) => {
        const queueEvent = queueEvents.find((queue) => queue.name === name)!

        if (!queueEvent) {
        logger.warn(`QueueEvent ${name} not found`);
        }

        return queueEvent
    }

    const disconnect = async () => {
        for(const event of queueEvents){
            await event.removeAllListeners()
        }
    }

    return {
        initQueue,
        initQueueEvent,
        getQueue,
        getQueueEvents,
        disconnect,
        getQueues,
        connectionOptions
    }
}