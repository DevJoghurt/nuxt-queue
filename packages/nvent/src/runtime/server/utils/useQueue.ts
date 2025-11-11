// Provider-first facade. Delegates to the active QueueProvider.
// Removes legacy BullMQ wiring, Redis options, QueueEvents, and peer handling.

import type { QueueEvent, JobsQuery, ScheduleOptions, JobInput, JobCounts } from '../queue/types'
import { getQueueProvider } from '../queue/queueFactory'

export const useQueue = () => {
  const provider = getQueueProvider()

  return {
    // Enqueue immediately
    enqueue: (queue: string, job: JobInput) => provider.enqueue(queue, job),

    // Schedule with optional delay or cron
    schedule: (queue: string, job: JobInput, opts?: ScheduleOptions) => provider.schedule(queue, job, opts),

    // Fetch single job
    getJob: (queue: string, id: string) => provider.getJob(queue, id),

    // List jobs (provider decides states/pagination)
    getJobs: (queue: string, q?: JobsQuery) => provider.getJobs(queue, q),

    // Subscribe to provider-agnostic events
    on: (queue: string, event: QueueEvent, cb: (p: any) => void) => provider.on(queue, event, cb),

    // Operational controls
    pause: (queue: string) => provider.pause(queue),
    resume: (queue: string) => provider.resume(queue),

    // Optional helpers if provider exposes them
    getJobCounts: (queue: string) => provider.getJobCounts ? provider.getJobCounts(queue) : Promise<JobCounts>,
    isPaused: (queue: string) => provider.isPaused ? provider.isPaused(queue) : Promise.resolve(undefined as any),

    // Provider lifecycle (normally handled by plugin/provider)
    close: () => provider.close(),
  }
}
