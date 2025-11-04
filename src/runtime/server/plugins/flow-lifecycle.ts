/**
 * Flow Lifecycle Management Plugin
 *
 * Handles flow start events and orchestration:
 * - Processes triggers/emits and starts new flows
 * - Emits flow.start events for new flow runs
 *
 * Note: Flow completion tracking (flow.completed events) is NOT implemented in v0.4
 * because it requires shared state across horizontally-scaled instances.
 * This will be implemented in v0.6 with the new distributed state system.
 * As a result, the 'on-complete' cleanup strategy is not functional in v0.4.
 */

import { defineNitroPlugin, useEventManager, $useQueueRegistry, useQueue } from '#imports'

export default defineNitroPlugin((nitro) => {
  const { onType, publishBus } = useEventManager()
  const registry = $useQueueRegistry() as any

  // Cache for flowId -> flowName resolution (read-only cache, safe for multi-instance)
  const flowIdToName = new Map<string, string>()

  // Helper to resolve flowId to flowName
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

  // Subscribe to lifecycle events
  const unsubscribes: Array<() => void> = []

  // ============================================================================
  // FLOW START: Handle emit events to trigger flows
  // ============================================================================
  unsubscribes.push(onType('emit', async (e: any) => {
    // Extract trigger name from emit event data
    const emitName = (e.data as any)?.name
    if (!emitName) return

    // Check if this emit matches any registered trigger
    const triggers = Object.keys(registry?.eventIndex || {})
    if (!triggers.includes(emitName)) return

    // Lazy load useQueue (only when needed, after queues plugin has initialized)
    const { enqueue } = useQueue()

    // Extract runId and flowName from event
    const runId = e.runId
    const flowName = e.flowName

    const targets = (registry?.eventIndex as Record<string, Array<{ flowId: string, step: string, queue: string }>>)[emitName] || []

    for (const t of targets) {
      const payload = { ...e.data, flowId: runId, flowName }
      // Idempotent job id: <runId>__<step> (':' not allowed by BullMQ)
      const jobId = runId ? `${runId}__${t.step}` : undefined

      try {
        const id = await enqueue(t.queue, { name: t.step, data: payload, opts: jobId ? { jobId } : undefined })

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
          console.log('[flow-lifecycle] enqueue skipped (likely duplicate):', { step: t.step, jobId, error: (err as any)?.message })
        }
      }
    }
  }))

  // ============================================================================
  // CLEANUP
  // ============================================================================
  nitro.hooks.hook('close', () => {
    unsubscribes.forEach(fn => fn())
    flowIdToName.clear()
  })
})
