import { $useQueueRegistry, useQueue, useEventManager } from '#imports'

export const useFlowEngine = () => {
  const registry = $useQueueRegistry()
  const queueAdapter = useQueue()
  const eventsManager = useEventManager()

  const startFlow = async (flowName: string, payload: any = {}) => {
    const flow = (registry?.flows as Record<string, any>)?.[flowName]
    if (!flow || !flow.entry) throw new Error('Flow not found')
    const id = await queueAdapter.enqueue(flow.entry.queue, { name: flow.entry.step, data: payload })
    // Record a run index for this flow for quick listing and timeline lookup (use job id as correlationId)
    const corr = String(id)
    // Emit a flow.start event (derivable for timelines/projections without state)
    try {
      await eventsManager.publish({ kind: 'flow.start', data: { flowName } }, { flowId: corr, queue: flow.entry.queue, jobId: id })
    }
    catch { /* best-effort */ }
    return { id, queue: flow.entry.queue, step: flow.entry.step, correlationId: corr }
  }

  const handleTrigger = async (trigger: string, payload: any = {}) => {
    const targets = ((registry?.eventIndex as unknown) as Record<string, Array<{ flowId: string, step: string, queue: string }>>)?.[trigger]
    if (!targets?.length) return []
    const enqueued = [] as Array<{ flowId: string, step: string, queue: string, id?: string }>
    for (const t of targets) {
      // Idempotent job id by correlationId + step when available
      let jobId: string | undefined
      const corr = (payload && (payload.correlationId || payload.traceId)) || undefined
      if (corr) jobId = `${String(corr)}__${t.step}`
      const opts = jobId ? { jobId } : undefined
      const id = await queueAdapter.enqueue(t.queue, { name: t.step, data: payload, opts })
      enqueued.push({ ...t, id })
    }
    return enqueued
  }

  // Idempotency via jobId uniqueness: <correlationId>__<step>
  // Check by querying the QueueProvider for existence of such a job on the target queue.
  const hasTriggered = async (correlationId: string, step: string, queue: string) => {
    const jobId = `${String(correlationId)}__${step}`
    try {
      const job = await queueAdapter.getJob(queue, jobId)
      return !!job
    }
    catch { return false }
  }

  // No-op: jobId uniqueness ensures idempotency; projections can infer from events.
  const markTriggered = async (_correlationId: string, _step: string, _queue?: string) => {}

  return { startFlow, handleTrigger, hasTriggered, markTriggered }
}
