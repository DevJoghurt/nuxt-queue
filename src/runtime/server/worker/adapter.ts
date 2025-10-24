import { Worker } from 'bullmq'
import { createBullMQProcessor, type NodeHandler } from './runner/node'
import { useRuntimeConfig } from '#imports'

// Adapter registers TS handlers as provider-native workers (BullMQ for now)
// Later, we will abstract Worker creation per provider.
export async function registerTsWorker(queueName: string, handler: NodeHandler, opts?: any) {
  // Create BullMQ Worker directly; do not depend on provider init ordering
  const processor = createBullMQProcessor(handler, queueName)
  const rc: any = useRuntimeConfig()
  const connection = rc?.queue?.redis
  const worker = new Worker(queueName, processor as any, { connection, ...(opts || {}) })
  return worker
}
