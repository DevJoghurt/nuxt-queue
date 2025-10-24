import { defineNitroPlugin, useMetrics, useEventManager, $useQueueRegistry, useFlowEngine, useQueue } from '#imports'

export default defineNitroPlugin(() => {
  const { onKind, publish } = useEventManager()
  const registry = $useQueueRegistry() as any
  const unsubs: Array<() => void> = []
  // Cache for flowId -> flowName resolution
  const flowIdToName = new Map<string, string>()
  const getFlowNameById = (id: string): string | undefined => {
    const cached = flowIdToName.get(id)
    if (cached) return cached
    try {
      const flows = (registry?.flows || {}) as Record<string, any>
      for (const [name, def] of Object.entries(flows)) {
        if ((def as any)?.id === id) {
          flowIdToName.set(id, name)
          return name
        }
      }
    }
    catch {
      // ignore
    }
    return undefined
  }

  // Subscribe to all trigger kinds present in registry.eventIndex
  const kinds = Object.keys(registry?.eventIndex || {})
  for (const kind of kinds) {
    unsubs.push(onKind(kind, async (e: any) => {
      const { hasTriggered, markTriggered } = useFlowEngine()
      const { enqueue } = useQueue()
      const { incCounter } = useMetrics()
      const corr = e.correlationId || e.meta?.correlationId || e.data?.correlationId
      const targets = (registry?.eventIndex as Record<string, Array<{ flowId: string, step: string, queue: string }>>)[kind] || []
      for (const t of targets) {
        let skip = false
        if (corr) {
          const already = await hasTriggered(corr, t.step, t.queue)
          if (already) skip = true
        }
        if (skip) continue
        const payload = { ...e.data, correlationId: corr || e.correlationId }
        // Idempotent job id: <correlationId>__<step> (':' not allowed by BullMQ)
        const jobId = corr ? `${String(corr)}__${t.step}` : undefined
        const id = await enqueue(t.queue, { name: t.step, data: payload, opts: jobId ? { jobId } : undefined })
        try {
          incCounter('flow_enqueues_total', { flowId: t.flowId || 'unknown', step: t.step })
        }
        catch {
          // ignore
        }
        // Emit flow.start for trigger-originated runs to align with streams-first derivations
        try {
          const flowName = getFlowNameById(String(t.flowId)) || String(t.flowId)
          await publish({ kind: 'flow.start', data: { flowName } }, { flowId: String(id), queue: t.queue, jobId: id })
        }
        catch {
          // best-effort
        }
        if (corr) await markTriggered(corr, t.step, t.queue)
      }
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
