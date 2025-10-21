import { defineNitroPlugin, $useEventBus, $useStateProvider } from '#imports'

interface JobSnapshot {
  id: string
  queue: string
  state: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'paused' | 'unknown'
  progress?: number
  returnvalue?: any
  failedReason?: string
  updatedAt: string
}

interface QueueStats {
  queue: string
  waiting?: number
  active?: number
  completed?: number
  failed?: number
  delayed?: number
  total?: number
  updatedAt: string
}

export default defineNitroPlugin(() => {
  const { onKind } = $useEventBus()
  const state = $useStateProvider()

  const jobKinds = ['job.waiting', 'job.active', 'job.progress', 'job.completed', 'job.failed', 'job.delayed']

  const unsubs: Array<() => void> = []

  const upsertJob = async (queue: string, jobId: string, kind: string, payload: any) => {
    const key = `proj:job:${queue}:${jobId}`
    await state.patch<JobSnapshot>(key, (prev) => {
      const now = new Date().toISOString()
      const base: JobSnapshot = prev || { id: jobId, queue, state: 'unknown', updatedAt: now }
      switch (kind) {
        case 'job.waiting':
          base.state = 'waiting'
          break
        case 'job.active':
          base.state = 'active'
          break
        case 'job.progress':
          if (typeof payload?.progress === 'number') base.progress = payload.progress
          else if (typeof payload === 'number') base.progress = payload
          else if (typeof payload?.data === 'number') base.progress = payload.data
          break
        case 'job.completed':
          base.state = 'completed'
          if (payload?.returnvalue !== undefined) base.returnvalue = payload.returnvalue
          break
        case 'job.failed':
          base.state = 'failed'
          if (typeof payload?.failedReason === 'string') base.failedReason = payload.failedReason
          else if (typeof payload?.reason === 'string') base.failedReason = payload.reason
          break
        case 'job.delayed':
          base.state = 'delayed'
          break
      }
      base.updatedAt = now
      return base
    }, { retries: 1 })
  }

  const bumpQueue = async (queue: string, kind: string) => {
    const key = `proj:queue:${queue}`
    await state.patch<QueueStats>(key, (prev) => {
      const now = new Date().toISOString()
      const base: QueueStats = prev || { queue, updatedAt: now }
      base.updatedAt = now
      base.total = (base.total || 0) + 1
      if (kind === 'job.waiting') base.waiting = (base.waiting || 0) + 1
      if (kind === 'job.active') base.active = (base.active || 0) + 1
      if (kind === 'job.completed') base.completed = (base.completed || 0) + 1
      if (kind === 'job.failed') base.failed = (base.failed || 0) + 1
      if (kind === 'job.delayed') base.delayed = (base.delayed || 0) + 1
      return base
    }, { retries: 1 })
  }

  for (const k of jobKinds) {
    unsubs.push(onKind(k, async (e) => {
      const queue = e.subject || ''
      const jobId = e.data?.jobId || e.data?.id || e.causationId || ''
      if (!queue || !jobId) return
      await upsertJob(queue, String(jobId), e.kind, e.data)
      await bumpQueue(queue, e.kind)
    }))
  }

  return {
    hooks: {
      close: async () => {
        for (const u of unsubs) {
          try {
            u()
          }
          catch {
            // ignore
          }
        }
        unsubs.length = 0
      },
    },
  }
})
