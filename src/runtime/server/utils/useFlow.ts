import {
  type ConnectionOptions,
  type RedisOptions,
  type FlowJob,
  FlowProducer,
} from 'bullmq'
import { useRuntimeConfig } from '#imports'

export const $useFlow = () => {
  const { redis: {
    host,
    port,
    password,
    username,
  } } = useRuntimeConfig().queue

  const redisOptions: RedisOptions = {
    host,
    port,
    retryStrategy: function (times: number) {
      return Math.max(Math.min(Math.exp(times), 20000), 1000)
    },
  }
  if (password) redisOptions.password = password
  if (username) redisOptions.username = username

  const connectionOptions: ConnectionOptions = {
    host,
    port,
  }

  const flowProducer = new FlowProducer({
    connection: connectionOptions,
  })

  const addFlow = async (flowJob: FlowJob) => {
    return await flowProducer.add(flowJob)
  }

  return {
    addFlow,
  }
}
