export default defineWorker('Bla name',async (job) => {
    job.log('Hello from bla worker')
    console.log('Hello from bla worker')
})