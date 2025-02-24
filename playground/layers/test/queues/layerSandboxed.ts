export default defineQueueWorker('layerSandboxed', async (job) => {
  job.log('Hello from layerSandboxed worker')
  job.updateProgress(100)
  console.log('Hello from layerSandboxed worker')
})
