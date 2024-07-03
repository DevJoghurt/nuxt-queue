async function wait(job) {
    return new Promise((resolve, reject) => {
        let counter = 0
        let intval = setInterval(async () => {
            job.log('Worker interval ' + counter)
            await job.updateProgress(counter * 20)
            counter++
            if(counter > 5){
                clearInterval(intval)
                resolve()
            }
        }, 4000)
    })
  }


export default defineWorker({
    id: 'test',
    name: "Create Test Worker",
    description: "Read all data from Test db"
},async (job) => {
    job.log('Hello from test worker')
    await wait(job)
    return {
        status: 'success'
    }
})