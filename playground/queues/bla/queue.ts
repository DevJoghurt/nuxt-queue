export default defineQueueWorker('bla',async (job) => {
    job.log('Hello from bla worker')
    console.log('Hello from bla worker')
})