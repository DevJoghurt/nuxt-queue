import { $useQueueRegistry, $useStateProvider, $useQueueProvider } from '#imports'

export const $useFlowEngine = () => {
  const registry = $useQueueRegistry()
  const provider = $useQueueProvider()
  const state = $useStateProvider()

  const startFlow = async (flowId: string, payload: any = {}) => {
    const flow = (registry?.flows as Record<string, any>)?.[flowId]
    if (!flow || !flow.main) throw new Error('Flow not found')
    const id = await provider.enqueue(flow.main.queue, { name: flow.main.step, data: payload })
    // Record a run index for this flow for quick listing and timeline lookup (use job id as correlationId)
    const corr = String(id)
    const runKey = `flowrun:${flowId}:${corr}`
    const meta = { id: corr, flowId, queue: flow.main.queue, step: flow.main.step, createdAt: new Date().toISOString() }
    try {
      await state.set(runKey, meta)
    }
    catch {
      // best effort; runs listing will just be empty if storage fails
    }
    return { id, queue: flow.main.queue, step: flow.main.step, correlationId: corr }
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
      const id = await provider.enqueue(t.queue, { name: t.step, data: payload, opts })
      enqueued.push({ ...t, id })
    }
    return enqueued
  }

  const hasTriggered = async (correlationId: string, step: string) => {
    const key = `flow:${correlationId}:step:${step}`
    const done = await state.get<boolean>(key)
    return !!done
  }

  const markTriggered = async (correlationId: string, step: string) => {
    const key = `flow:${correlationId}:step:${step}`
    await state.set(key, true)
  }

  return { startFlow, handleTrigger, hasTriggered, markTriggered }
}
