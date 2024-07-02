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
})

export const pm2ProcessArray = z.array(pm2Process)