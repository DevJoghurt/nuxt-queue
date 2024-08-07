import pm2 from 'pm2'
import { consola } from "consola"
import type { StartOptions } from 'pm2'
import z from 'zod'

const processSchema = z.object({
    pid: z.number().optional(),
    pm2_env: z.object({
        namespace: z.string(),
        name: z.string(),
        status: z.string(),
        pm_uptime: z.number().optional(),
        unique_id: z.string().optional(),
        created_at: z.number().optional(),
        restart_time: z.number(),
        version: z.string().optional(),
        node_version: z.string().optional()
    }),
    monit: z.object({
        memory: z.number(),
        cpu: z.number()
    }).optional()
}).transform((data)=>{
    return {
        id: data.pm2_env.name,
        pid: data.pid,
        namespace: data.pm2_env.namespace,
        status: data.pm2_env.status,
        uptime: data.pm2_env.pm_uptime,
        createdAt: data.pm2_env.created_at,
        restartTime: data.pm2_env.restart_time,
        version: data.pm2_env.version,
        nodeVersion: data.pm2_env.node_version,
        monitor: data.monit
    }
})

const processSchemaArray = z.array(processSchema)

type Process = z.infer<typeof processSchema>
type ProcessArray = z.infer<typeof processSchemaArray>

let pm2BusInstance  = null as any

type List = () => Promise<ProcessArray>
type Start = (options: StartOptions) => Promise<Process | null>
type Stop = (name: string) => Promise<Process | null>
type Pause = (name: string) => Promise<Process | null>
type Reload = (name: string) => Promise<Process | null>
type Restart = (name: string) => Promise<Process | null>
type Remove = (name: string) => Promise<Process | null>
type Describe = (name: string) => Promise<Process | null>

function connect() {
    return new Promise((resolve, reject) => {
        pm2.connect(false,(err)=>{
            if(err){
                return reject(err)
            }
            return resolve(true)
        })
    })
}

function pm2LaunchBus() {

    const logger = consola.create({}).withTag("PM2")

    return new Promise((resolve, reject) => {
        pm2.launchBus(function(err, pm2_bus) {
            if(err){
                logger.error('LaunchBus error', err)
                reject(null)
            }else{
                logger.success('Init LaunchBus successfully')
                resolve(pm2_bus)
            }
        })
    })
}

export const $usePM2 = () => {

    const initLaunchBus = async () => {
        await connect()
        if(!pm2BusInstance) 
            pm2BusInstance  = await pm2LaunchBus()

        return pm2BusInstance
    }


    const disconnect = () => {
        pm2.disconnect()
    }

    const start: Start = async (options: StartOptions) => {
        await connect()
        return new Promise((resolve, reject) => {
            pm2.start(options,async (err, processInstances)=>{
                if(err){
                    return reject(err)
                }
                const result = await processSchemaArray.safeParse(processInstances)
                if(result.success) 
                    if(result.data.length === 1)
                        return resolve(result.data[0])
                    else return resolve(null)
                else reject(`Error parsing result from process ${result.error}`)
            })
        })
    }

    const remove: Remove = async (name: string) => {
        await connect()
        return new Promise((resolve, reject) => {
            pm2.delete(name, async (err, processInstances)=>{
                if(err){
                    return reject(err)
                }
                const result = await processSchemaArray.safeParse(processInstances)
                if(result.success) 
                    if(result.data.length === 1)
                        return resolve(result.data[0])
                    else return resolve(null)
                else reject(`Error parsing result from process ${result.error}`)
            })
        })
    }

    const list: List = async () => {
        await connect()
        return new Promise((resolve, reject) => {
            pm2.list(async (err, processInstances)=>{
                if(err){
                    return reject(err)
                }
                const result = await processSchemaArray.safeParse(processInstances)
                if(result.success) 
                    return resolve(result.data)
                else reject(`Error parsing result from process ${result.error}`)
            })
        })
    }

    const restart: Restart = async(name: string) => {
        await connect()
        return new Promise((resolve, reject) => {
            pm2.restart(name, async(err, processInstances)=>{
                if(err){
                    return reject(err)
                }
                const result = await processSchemaArray.safeParse(processInstances)
                if(result.success) 
                    if(result.data.length === 1)
                        return resolve(result.data[0])
                    else return resolve(null)
                else reject(`Error parsing result from process ${result.error}`)
            })
        })
    }

    const reload: Reload = async (name: string) => {
        await connect()

        return new Promise((resolve, reject) => {
            pm2.reload(name, async (err, processInstances)=>{
                if(err){
                    return reject(err)
                }
                const result = await processSchemaArray.safeParse(processInstances)
                if(result.success) 
                    if(result.data.length === 1)
                        return resolve(result.data[0])
                    else return resolve(null)
                else reject(`Error parsing result from process ${result.error}`)
            })
        })
    }

    const describe: Describe = async (name: string) => {
        await connect()

        return new Promise((resolve, reject) => {
            pm2.describe(name, async (err, processInstances)=>{
                if(err){
                    return reject(err)
                }
                const result = await processSchemaArray.safeParse(processInstances)
                if(result.success) 
                    if(result.data.length === 1)
                        return resolve(result.data[0])
                    else return resolve(null)
                else reject(`Error parsing result from process ${result.error}`)
            })
        })
    }

    const stop: Stop = async (name: string) => {
        await connect()
        return new Promise((resolve, reject) => {
            pm2.stop(name,async (err, processInstances)=>{
                if(err){
                    return reject(err)
                }
                const result = await processSchemaArray.safeParse(processInstances)
                if(result.success) 
                    if(result.data.length === 1)
                        return resolve(result.data[0])
                    else return resolve(null)
                else reject(`Error parsing result from process ${result.error}`)
            })
        })
    }

    return {
        start,
        stop,
        list,
        describe,
        disconnect,
        remove,
        reload,
        restart,
        initLaunchBus,
        eventBus: pm2BusInstance
    }
}