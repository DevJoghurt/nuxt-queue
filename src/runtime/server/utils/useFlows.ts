import { useEventManager, useStreamStore } from '#imports'
import { getStreamNames, getProjectionStreamNames } from '../streamStore/streamNames'

export interface FlowEventPayload<T = any> {
  kind: string
  data?: T
  meta?: any
}

// Snapshot type kept local to avoid another composable
type FlowRunSnapshot = {
  status?: 'running' | 'completed' | 'failed' | string
  flowName?: string
  flowId?: string
  queue?: string
  startedAt?: string
  completedAt?: string
  lastEventAt?: string
  logsCount?: number
  lastLogLevel?: 'debug' | 'info' | 'warn' | 'error' | string
}

export function useFlows() {
  const eventManager = useEventManager()
  const streamFactory = { names: getStreamNames() }
  const store = useStreamStore()

  function on(kind: string, handler: (evt: any) => void) {
    return eventManager.onKind(kind, handler)
  }

  async function publishStart(ctx: { flowId: string, flowName: string, queue?: string }) {
    await eventManager.publishBus({ kind: 'flow.start', subject: ctx.queue, data: { flowName: ctx.flowName }, meta: { flowId: ctx.flowId } })
  }

  async function publishStep(step: string, ctx: { flowId: string, queue?: string, jobId?: string }, data?: any) {
    await eventManager.publishBus({ kind: `flow.step.${step}`, subject: ctx.queue, data: { step, ...(data || {}) }, meta: { flowId: ctx.flowId } })
  }

  async function publishComplete(ctx: { flowId: string, queue?: string }, data?: any) {
    await eventManager.publishBus({ kind: 'flow.complete', subject: ctx.queue, data: { ...(data || {}) }, meta: { flowId: ctx.flowId } })
  }

  /**
   * Get recent runs for a given flow name using the projection index stream.
   * Newest-first paging supported by adapter (reads projection stream directly).
   */
  async function getFlowRuns(flowName: string, opts?: { limit?: number, fromId?: string, paged?: boolean, direction?: 'forward' | 'backward' }) {
    if (!flowName) return [] as Array<{ id: string, flowName: string, queue?: string, createdAt: string }>
    const limit = opts?.limit ?? 50
    const pnames = getProjectionStreamNames()
    const runIndex = pnames.flowRuns(flowName)
    const res = await (async () => {
      if (opts?.paged) {
        const page = await store.read(runIndex, { limit: limit * 5, fromId: opts?.fromId, direction: opts?.direction || 'backward' })
        const items = page.slice(0, limit)
        const nextFromId = page.length >= limit * 5 ? page[page.length - 1]?.id : undefined
        return { items, nextFromId }
      }
      return await store.read(runIndex, { limit, fromId: opts?.fromId, direction: opts?.direction || 'backward' })
    })()
    const arr = (opts?.paged ? ((res as any).items || []) : Array.isArray(res) ? res : (res as any).items) as any[]
    // Normalize and dedupe by id in case of duplicate index entries
    const items: Array<{ id: string, flowName: string, queue?: string, createdAt: string }> = []
    const seen = new Set<string>()
    for (const r of arr) {
      const d: any = r.data || {}
      const id = String(d.id || '')
      if (!id || seen.has(id)) continue
      seen.add(id)
      items.push({ id, flowName, queue: d.queue || r.subject, createdAt: d.createdAt || r.ts })
      if (!opts?.paged && items.length >= limit) break
    }
    return opts?.paged ? { items, nextFromId: (res as any).nextFromId } as any : items
  }

  /**
   * Read the timeline (events) for a specific flow run.
   * The flowName is accepted for symmetry but not required to read the run stream.
   */
  async function getFlowTimeline(runId: string, opts?: { limit?: number, fromId?: string, direction?: 'forward' | 'backward', paged?: boolean }) {
    if (!runId) return []
    const streams = streamFactory.names
    const flowStream = typeof streams.flow === 'function' ? streams.flow(runId) : `${streams.flow}${runId}`
    const res = await (async () => {
      const limit = opts?.limit ?? 200
      if (opts?.paged) {
        const page = await store.read(flowStream, { limit: limit * 5, fromId: opts?.fromId, direction: opts?.direction || 'forward' })
        const items = page.slice(0, limit)
        const nextFromId = page.length >= limit * 5 ? page[page.length - 1]?.id : undefined
        return { items, nextFromId }
      }
      return await store.read(flowStream, { limit, fromId: opts?.fromId, direction: opts?.direction || 'forward' })
    })()
    return (opts?.paged ? res : Array.isArray(res) ? res : res.items)
  }

  /** Subscribe to a specific flow run's stream. */
  function onFlow(runId: string, handler: (evt: any) => void) {
    const streams = streamFactory.names
    const flowStream = typeof streams.flow === 'function' ? streams.flow(runId) : `${streams.flow}${runId}`
    // Subscribe via the stream store adapter (Store Bus)
    return store.subscribe(flowStream, handler as any)
  }

  /** Subscribe to new indexed runs for a given flow name via the projection stream. */
  function onFlowRuns(flowName: string, handler: (evt: any) => void) {
    const pnames = getProjectionStreamNames()
    const s = pnames.flowRuns(flowName)
    // Subscribe via adapter-backed store subscription
    return store.subscribe(s, (e: any) => handler(e))
  }

  /**
   * Read and reduce the flow run snapshot stream to a single object.
   * Uses the stream adapter via eventManager.read (no StateProvider).
   */
  async function getFlowRunSnapshot(flowName: string, flowId: string): Promise<FlowRunSnapshot | null> {
    if (!flowName || !flowId) return null
    const pnames = getProjectionStreamNames()
    const s = pnames.flowSnapshot(flowName, flowId)
    const page = await store.read(s, { limit: 200 * 5, direction: 'backward' })
    const res = { items: page.slice(0, 200), nextFromId: page.length >= 1000 ? page[page.length - 1]?.id : undefined }
    const items = res.items
    const snap: FlowRunSnapshot = {}
    const ordered = [...items].reverse()
    for (const e of ordered) {
      const d: any = e.data || {}
      if (typeof d.status === 'string') snap.status = d.status
      if (d.flowName) snap.flowName = d.flowName
      if (d.flowId) snap.flowId = d.flowId
      if (d.queue) snap.queue = d.queue
      if (d.startedAt) snap.startedAt = d.startedAt
      if (d.completedAt) snap.completedAt = d.completedAt
      if (d.lastEventAt) snap.lastEventAt = d.lastEventAt
      if (typeof d.logsCountDelta === 'number') snap.logsCount = (snap.logsCount || 0) + d.logsCountDelta
      if (d.lastLogLevel) snap.lastLogLevel = d.lastLogLevel
    }
    return snap
  }

  /**
   * Read and reduce per-step snapshots for a specific flow run.
   * Returns a map of stepId -> snapshot.
   */
  async function getFlowStepSnapshots(flowId: string): Promise<Record<string, any>> {
    if (!flowId) return {}
    const pnames = getProjectionStreamNames()
    const s = pnames.flowSteps(flowId)
    const page = await store.read(s, { limit: 500 * 5, direction: 'backward' })
    const res = { items: page.slice(0, 500), nextFromId: page.length >= 2500 ? page[page.length - 1]?.id : undefined }
    const items = res.items
    const ordered = [...items].reverse()
    const out: Record<string, any> = {}
    for (const e of ordered) {
      const d: any = e.data || {}
      const id = String(d.stepKey || '')
      if (!id) continue
      const snap = out[id] || { stepKey: id }
      if (d.step) snap.step = d.step // optional label
      if (typeof d.status === 'string') snap.status = d.status
      if (d.startedAt) snap.startedAt = d.startedAt
      if (d.completedAt) snap.completedAt = d.completedAt
      if (d.lastEventAt) snap.lastEventAt = d.lastEventAt
      if (typeof d.logsCountDelta === 'number') snap.logsCount = (snap.logsCount || 0) + d.logsCountDelta
      if (d.lastLogLevel) snap.lastLogLevel = d.lastLogLevel
      if (typeof d.triesCountDelta === 'number') snap.triesCount = (snap.triesCount || 0) + d.triesCountDelta
      if (typeof d.attempt === 'number') snap.attempt = d.attempt
      if (d.lastAttemptStatus) snap.lastAttemptStatus = d.lastAttemptStatus
      if (typeof d.waiting === 'boolean') snap.waiting = d.waiting
      if (d.waitingFor !== undefined) snap.waitingFor = d.waitingFor
      if (d.waitToken !== undefined) snap.waitToken = d.waitToken
      if (d.waitUntil !== undefined) snap.waitUntil = d.waitUntil
      out[id] = snap
    }
    return out
  }

  return { on, publishStart, publishStep, publishComplete, getFlowRuns, getFlowTimeline, onFlow, onFlowRuns, getFlowRunSnapshot, getFlowStepSnapshots }
}

export default useFlows
