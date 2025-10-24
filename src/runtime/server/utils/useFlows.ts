import { useEventManager } from '#imports'

export interface FlowEventPayload<T = any> {
  kind: string
  data?: T
  meta?: any
}

export function useFlows() {
  const eventManager = useEventManager()
  const streamFactory = { names: eventManager.getStreamNames() }

  async function publish(kind: string, data?: any, ctx?: { flowId?: string, queue?: string, jobId?: string }, meta?: any) {
    await eventManager.publish({ kind, data, meta }, ctx)
  }

  function on(kind: string, handler: (evt: any) => void) {
    return eventManager.onKind(kind, handler)
  }

  async function publishStart(ctx: { flowId: string, flowName: string, queue?: string }) {
    await publish('flow.start', { flowId: ctx.flowId, flowName: ctx.flowName }, ctx)
  }

  async function publishStep(step: string, ctx: { flowId: string, queue?: string, jobId?: string }, data?: any) {
    await publish(`flow.step.${step}`, { step, ...(data || {}) }, ctx)
  }

  async function publishComplete(ctx: { flowId: string, queue?: string }, data?: any) {
    await publish('flow.complete', { flowId: ctx.flowId, ...(data || {}) }, ctx)
  }

  /**
   * Get recent runs for a given flow name by scanning the global event stream
   * for `flow.start` events and deriving unique run IDs (correlationId).
   * Newest first. Uses a scan window to accommodate adapters without reverse reads.
   */
  async function getFlowRuns(flowName: string, opts?: { limit?: number, scanLimit?: number, fromId?: string, paged?: boolean }) {
    if (!flowName) return [] as Array<{ id: string, flowName: string, queue?: string, createdAt: string }>
    const limit = opts?.limit ?? 50
    const streams = eventManager.getStreamNames()
    // If paged, rely on adapter-backed paging to derive items and nextFromId
    if (opts?.paged) {
      const { items: recs, nextFromId } = await eventManager.read({
        stream: streams.global,
        limit: Math.max(limit, 1),
        fromId: opts?.fromId,
        direction: 'backward',
        paged: true,
      }) as { items: any[], nextFromId?: string }
      const items: Array<{ id: string, flowName: string, queue?: string, createdAt: string }> = []
      const seen = new Set<string>()
      for (const r of recs) {
        if (r.kind !== 'flow.start') continue
        const data: any = r.data || {}
        if (data.flowName !== flowName) continue
        const id = r.correlationId || String(data.correlationId || '')
        if (!id || seen.has(id)) continue
        seen.add(id)
        items.push({ id, flowName, queue: r.subject, createdAt: r.ts })
        if (items.length >= limit) break
      }
      return { items, nextFromId } as any
    }
    // Non-paged: scan a reverse window for newest-first and dedupe
    const scanLimit = opts?.scanLimit ?? Math.max(limit * 2, 100)
    const recs = await eventManager.read({ stream: streams.global, limit: scanLimit, direction: 'backward' }) as any[]
    const runs: Array<{ id: string, flowName: string, queue?: string, createdAt: string }> = []
    const seen = new Set<string>()
    for (const r of recs) {
      if (r.kind !== 'flow.start') continue
      const data: any = r.data || {}
      if (data.flowName !== flowName) continue
      const id = r.correlationId || String(data.correlationId || '')
      if (!id || seen.has(id)) continue
      seen.add(id)
      runs.push({ id, flowName, queue: r.subject, createdAt: r.ts })
      if (runs.length >= limit) break
    }
    // recs are newest-first in backward mode; no need to sort, but keep a defensive sort if adapters vary
    if (runs.length > 1) runs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    return runs.slice(0, limit)
  }

  /**
   * Read the timeline (events) for a specific flow run.
   * The flowName is accepted for symmetry but not required to read the run stream.
   */
  async function getFlowTimeline(runId: string, opts?: { limit?: number, fromId?: string, direction?: 'forward' | 'backward', paged?: boolean }) {
    if (!runId) return []
    const streams = streamFactory.names
    const flowStream = typeof streams.flow === 'function' ? streams.flow(runId) : `${streams.flow}${runId}`
    const res = await eventManager.read({
      stream: flowStream,
      limit: opts?.limit ?? 200,
      fromId: opts?.fromId,
      direction: opts?.direction || 'forward',
      paged: !!opts?.paged,
    }) as any
    return (opts?.paged ? res : Array.isArray(res) ? res : res.items)
  }

  /** Subscribe to a specific flow run's stream. */
  function onFlow(runId: string, handler: (evt: any) => void) {
    const streams = streamFactory.names
    const flowStream = typeof streams.flow === 'function' ? streams.flow(runId) : `${streams.flow}${runId}`
    // Prefer eventManager's subscribeStream which bridges to the adapter
    return eventManager.subscribeStream(flowStream, handler as any)
  }

  /** Subscribe to flow.start events for a given flow name (for live run discovery). */
  function onFlowRuns(flowName: string, handler: (evt: any) => void) {
    return eventManager.onKind('flow.start', (e: any) => {
      const d = (e?.data || {}) as any
      if (d.flowName === flowName) handler(e)
    })
  }

  return { publish, on, publishStart, publishStep, publishComplete, getFlowRuns, getFlowTimeline, onFlow, onFlowRuns }
}

export default useFlows
