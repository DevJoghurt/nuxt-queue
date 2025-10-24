import { defineEventHandler, getRouterParam, useRuntimeConfig, useQueue } from '#imports'

export default defineEventHandler(async (event) => {
  const name = getRouterParam(event, 'name')
  if (!name) throw 'Queue name is required'
  const rc: any = useRuntimeConfig()
  const cfgQueues = rc?.queue?.queues || {}
  if (!cfgQueues[name]) {
    // allow transient queues discovered from registry; we don't block listing even if not configured
    // continue
  }
  const { getJobs } = useQueue()
  const jobs = await getJobs(name, { limit: 50 })
  return { jobs }
})
