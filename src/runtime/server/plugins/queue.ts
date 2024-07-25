import { defineNitroPlugin } from 'nitropack/runtime'
import { consola } from "consola"
import worker from "#worker"
import { $useQueue, $usePM2 } from '#imports'

export default defineNitroPlugin(async (nitro) => {
    const logger = consola.create({}).withTag("QUEUE")

    const { initQueue, initQueueEvent, disconnect: disconnectQueues } = $useQueue()
    const { initLaunchBus, disconnect: disconnectPM2 } = $usePM2()

    const pm2EventBus = await initLaunchBus()

    pm2EventBus.on('process:msg', function(processMsg) {
        logger.info(`Process [${processMsg?.process?.namespace || ''}]`, processMsg?.data?.message)
        if(processMsg?.data?.event === 'error'){
            logger.error(`Process [${processMsg?.process?.namespace || ''}]`,processMsg?.data?.message)
        }
        if(processMsg?.data?.event === 'completed'){
            logger.info(`Process [${processMsg?.process?.namespace || ''}]`, `Job #${processMsg?.data?.message?.id} finished successfully`)
        }
    })

    for(const workerInstance of worker) {
        initQueue(workerInstance.name)
        initQueueEvent(workerInstance.name)
    }


    nitro.hooks.hook("close", async () => {
        await disconnectPM2()
        await disconnectQueues()
        // Will run when nitro is being closed
        logger.info('Closed queue server plugin')
    })
})