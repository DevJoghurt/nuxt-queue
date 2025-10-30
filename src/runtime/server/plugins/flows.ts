import { defineNitroPlugin, useMetrics, useEventManager, $useQueueRegistry, useQueue } from '#imports'

export default defineNitroPlugin(() => {
  const { onType, publishBus } = useEventManager()
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

  // Subscribe to 'emit' type events to handle all triggers
  unsubs.push(onType('emit', async (e: any) => {
    // v0.4: Extract trigger name from emit event data
    const emitName = (e.data as any)?.name
    if (!emitName) return

    // Check if this emit matches any registered trigger
    const triggers = Object.keys(registry?.eventIndex || {})
    if (!triggers.includes(emitName)) return

    const { enqueue } = useQueue()
    const { incCounter } = useMetrics()

    // v0.4: Extract runId and flowName from event
    const runId = e.runId
    const flowName = e.flowName

    const targets = (registry?.eventIndex as Record<string, Array<{ flowId: string, step: string, queue: string }>>)[emitName] || []

    for (const t of targets) {
      const payload = { ...e.data, flowId: runId, flowName }
      // Idempotent job id: <runId>__<step> (':' not allowed by BullMQ)
      const jobId = runId ? `${runId}__${t.step}` : undefined

      try {
        const id = await enqueue(t.queue, { name: t.step, data: payload, opts: jobId ? { jobId } : undefined })

        try {
          incCounter('flow_enqueues_total', { flowId: t.flowId || 'unknown', step: t.step })
        }
        catch {
          // ignore metrics errors
        }

        // Emit flow.start ONLY for trigger-originated NEW runs (no existing runId)
        // If runId already exists, this is a continuation, not a start
        if (!runId) {
          try {
            const targetFlowName = getFlowNameById(String(t.flowId)) || String(t.flowId)
            // Publish flow.start annotated to the run trace
            const newRunId = String(id)
            await publishBus({ type: 'flow.start', runId: newRunId, flowName: targetFlowName, data: { input: payload } })
          }
          catch {
            // best-effort
          }
        }
      }
      catch (err) {
        // Enqueue failed - likely duplicate jobId (idempotency working correctly)
        // Silently skip; this is expected when same trigger fires multiple times
        if (process.env.NQ_DEBUG_EVENTS === '1') {
          console.log('[flows] enqueue skipped (likely duplicate):', { step: t.step, jobId, error: (err as any)?.message })
        }
      }
    }
  }))

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
