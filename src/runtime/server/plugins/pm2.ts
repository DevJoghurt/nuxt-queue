import { defineNitroPlugin } from '#imports'
import { consola } from "consola"
import pm2 from 'pm2'

export default defineNitroPlugin((nitro) => {
    const logger = consola.create({}).withTag("PM2")
    pm2.launchBus(function(err, pm2_bus) {
        if(err){
            logger.error('LaunchBus error')
        }
        pm2_bus.on('process:msg', function(processMsg) {
            if(processMsg?.data?.event === 'error'){
                logger.error(`Process [${processMsg?.process?.namespace || ''}]`,processMsg?.data?.message)
            }
            if(processMsg?.data?.event === 'completed'){
                logger.info(`Process [${processMsg?.process?.namespace || ''}]`, `Job #${processMsg?.data?.message?.id} finished successfully`)
            }
        })
    })
    nitro.hooks.hook("close", async () => {
      // Will run when nitro is being closed
      console.log('closed pm2 server plugin')
    })
})