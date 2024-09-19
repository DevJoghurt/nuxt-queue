import type { Processor, WorkerOptions as BullmqWorkerOptions } from 'bullmq'

type WorkerOptions = Omit<BullmqWorkerOptions, 'connection'>

// Wrapper for bull worker

export const defineQueueWorker = (
  meta: string | WorkerOptions,
  processor: Processor
) => {

  return processor
}