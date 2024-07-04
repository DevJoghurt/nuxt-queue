import type { Processor, Job } from "bullmq"
import { Worker, MetricsTime } from "bullmq"
import type { WorkerOptions } from '../../types'

//Wrapper for bull worker

const redisConfig = {
  host: 'localhost',
  port: 6379
}

type WorkerMeta = string | {
  id: string;
  name?: string;
  description?: string;
}

type WorkerProcessor = Processor | {
  worker: Processor;
  onCompleted: (job: Job, returnValue: any) => void;
  onProgress: (job: Job, progress: number | object) => void;
  onFailed: (job: Job, error: any ) => void;
}

function sendMessage(event: string, message: any) {
  if(process.send)
    process.send({
      type : 'process:msg',
      data : {
        event,
        message
      }
    })
}


export const defineWorker = (
  meta: WorkerMeta,
  processor: WorkerProcessor,
  opts?: WorkerOptions
) => {

  let id = ''
  if(typeof meta === 'string'){
    id = meta
  }else{
    id = meta.id
  }

  let workerFunction: Processor = async () => {}  
  if(typeof processor === "function"){
    workerFunction = processor
  }else{
    workerFunction = processor.worker
  }

  const worker = new Worker(
    id,
    workerFunction,
    {
      connection: {
        host: redisConfig.host,
        port: redisConfig.port
      },
      ...Object.assign(opts || {},{
        metrics: {
          maxDataPoints: MetricsTime.ONE_WEEK * 2,
        }
      })
    },
  );

  worker.on('completed', (job)=>{
    sendMessage('completed', job);
  });

  worker.on('ioredis:close', ()=>{
    sendMessage('ioredis:close', 'Connection to redis is lost');
  });

  worker.on('closing', (err)=>{
    sendMessage('error', err);
  });

  worker.on('error', (err)=>{
    sendMessage('error', err);
  });

  worker.run(); 

  //TODO: implement graceful shutdown of worker -> worker.stop()
  process.on('SIGINT', async function() {
    sendMessage('error', 'Worker closed');
    console.log('close worker gracefully')
    await worker.close()
    setTimeout(()=>{
      console.log('wait until shutdown')
      process.exit(0)
    }, 2000)
 })

}