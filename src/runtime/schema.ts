import z from 'zod'

export const JobSchema = z.object({
    id: z.string(),
    name: z.string(),
    data: z.any(),
    progress: z.number(),
    opts: z.object({
        attempts: z.number(),
        delay: z.number()
    }),
    state: z.any(), 
    returnvalue: z.any(),
    attemptsStarted: z.number(),
    attemptsMade: z.number(),
    delay: z.number(),
    timestamp: z.number().transform((timestamp)=> new Date(timestamp).toLocaleString()),
    finishedOn: z.number().optional().transform((timestamp)=> timestamp? new Date(timestamp).toLocaleString() : undefined),
    processedOn: z.number().optional()
})

export const JobSchemaArray = z.array(JobSchema)