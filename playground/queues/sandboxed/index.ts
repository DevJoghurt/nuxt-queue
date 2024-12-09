export default defineQueueWorker('sandboxed', async (job) => {
  job.log('Hello from bla worker')
  job.updateProgress(100)
  console.log('Hello from bla worker')
})
