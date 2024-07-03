import z from 'zod'

export const pm2Process = z.object({
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

export const pm2ProcessArray = z.array(pm2Process)