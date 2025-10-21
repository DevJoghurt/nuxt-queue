import { defineNitroPlugin, useMetrics, $useEventBus, $useQueueRegistry, $useFlowEngine, $useQueueProvider } from '#imports'

export default defineNitroPlugin(() => {
  const { onKind } = $useEventBus()
  const registry = $useQueueRegistry() as any
  const unsubs: Array<() => void> = []

  // Subscribe to all trigger kinds present in registry.eventIndex
  const kinds = Object.keys(registry?.eventIndex || {})
  for (const kind of kinds) {
    unsubs.push(onKind(kind, async (e) => {
      const { hasTriggered, markTriggered } = $useFlowEngine()
      const provider = $useQueueProvider()
      const { incCounter } = useMetrics()
      const corr = e.correlationId || e.meta?.correlationId || e.data?.correlationId
      const targets = (registry?.eventIndex as Record<string, Array<{ flowId: string, step: string, queue: string }>>)[kind] || []
      for (const t of targets) {
        let skip = false
        if (corr) {
          const already = await hasTriggered(corr, t.step)
          if (already) skip = true
        }
        if (skip) continue
        const payload = { ...e.data, correlationId: corr || e.correlationId }
        // Idempotent job id: <correlationId>__<step> (':' not allowed by BullMQ)
        const jobId = corr ? `${String(corr)}__${t.step}` : undefined
        await provider.enqueue(t.queue, { name: t.step, data: payload, opts: jobId ? { jobId } : undefined })
        try {
          incCounter('flow_enqueues_total', { flowId: t.flowId || 'unknown', step: t.step })
        }
        catch {
          // ignore
        }
        if (corr) await markTriggered(corr, t.step)
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
