/**
 * Flow Management Plugin
 *
 * Handles NEW flow starts from external triggers:
 * - Processes external triggers to start new flows
 * - Emits flow.start events for new flow runs
 * - Maps flowIds to flowNames
 *
 * Note: Step orchestration (checking dependencies, triggering next steps)
 * is handled by flowWiring.ts which subscribes to emit/step.completed events
 */

import { defineNitroPlugin, useEventManager, $useQueueRegistry, useQueue, useNventLogger } from '#imports'

export default defineNitroPlugin((nitro) => {
  const logger = useNventLogger('plugin-flow-management')
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
  // FLOW START: Handle EXTERNAL triggers to start NEW flows
  // ============================================================================
  // Note: Internal flow step triggering is handled by useFlowEngine.startFlow(): Direct programmatic flow starts (API, tests, manual triggers)
  unsubscribes.push(onType('emit', async (e: any) => {
    // Only handle external triggers (no runId = new flow start)
    if (e.runId) return

    // Extract trigger name from emit event data
    const emitName = (e.data as any)?.name
    if (!emitName) return

    // Check if this emit matches any registered trigger
    const triggers = Object.keys(registry?.eventIndex || {})
    if (!triggers.includes(emitName)) return

    const { enqueue } = useQueue()
    const targets = (registry?.eventIndex as Record<string, Array<{ flowId: string, step: string, queue: string }>>)[emitName] || []

    for (const t of targets) {
      const payload = { ...e.data }

      try {
        // Enqueue the entry step (no jobId for new flows)
        const id = await enqueue(t.queue, { name: t.step, data: payload })

        // Publish flow.start event for the new flow run
        try {
          const targetFlowName = getFlowNameById(String(t.flowId)) || String(t.flowId)
          const newRunId = String(id)
          await publishBus({
            type: 'flow.start',
            runId: newRunId,
            flowName: targetFlowName,
            data: { input: payload },
          })

          if (process.env.NQ_DEBUG_EVENTS === '1') {
            logger.info('[flow-lifecycle] started new flow:', {
              flowName: targetFlowName,
              runId: newRunId,
              entryStep: t.step,
            })
          }
        }
        catch {
          // best-effort
        }
      }
      catch (err) {
        logger.warn('[flow-lifecycle] failed to start flow:', {
          step: t.step,
          error: (err as any)?.message,
        })
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
