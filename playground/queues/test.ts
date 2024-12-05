async function wait(job) {
  return new Promise((resolve) => {
    let counter = 0
    const intval = setInterval(async () => {
      job.log('Worker interval ' + counter)
      await job.updateProgress(counter * 20)
      counter++
      if (counter > 5) {
        clearInterval(intval)
        resolve(true)
      }
    }, 4000)
  })
}

export default defineQueueWorker({
  name: 'test'
}, async (job) => {
  job.log('Hello from test worker')
  await wait(job)
  return {
    status: 'success',
  }
})
