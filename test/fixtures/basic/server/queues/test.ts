export const config = {
  queue: { name: 'test' },
}

export default defineQueueWorker(async (job: any) => {
  return { processed: true, data: job.data }
})
