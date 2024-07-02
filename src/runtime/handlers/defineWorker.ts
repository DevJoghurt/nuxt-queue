import type { Processor } from "bullmq"
import { Worker } from "bullmq"
import type { WorkerOptions } from '../../types'

//emulate bull worker


export const defineWorker = (
  name: string,
  processor: Processor,
  opts?: WorkerOptions
) => {

  const { queue } = useRuntimeConfig()

  const worker = new Worker(
    name,
    processor,
    {
      connection: {
        host: queue.redis.host,
        port: queue.redis.port
      },
      ...opts
    },
  );

  worker.run(); 
  
  //emulate bull worker
  /*
  setInterval(async ()=>{
    await processor.call({
      name
    })
  }, 2000)
  */

  //TODO: implement graceful shutdown of worker -> worker.stop()
  process.on('SIGINT', function() {
    console.log('close worker gracefully')
    setTimeout(()=>{
      console.log('wait until shutdown')
      process.exit(0)
    }, 2000)
 })
}

