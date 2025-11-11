import { useEventManager, useStoreAdapter, SubjectPatterns } from '#imports'

export interface LogReadOptions {
  fromId?: string
  limit?: number
}

export function useLogs() {
  const eventManager = useEventManager()
  const store = useStoreAdapter()

  // Note: direct read helpers removed; prefer paged getters below or live subscriptions.

  /**
   * Unified logs reader for a job stream.
   * - When opts.paged is true, returns { items, nextFromId }
   * - Otherwise returns an array of events
   */
  async function getJobLogs(_jobId: string, _opts?: { limit?: number, fromId?: string, direction?: 'forward' | 'backward', paged?: boolean }) {
    // Queue-related logs are not stored in the stream store.
    // They should be retrieved via the Queue adapter/provider directly.
    return { items: [], nextFromId: undefined } as any
  }

  /**
   * Unified logs reader for a flow run stream.
   * - When opts.paged is true, returns { items, nextFromId }
   * - Otherwise returns an array of events
   */
  async function getFlowRunLogs(flowId: string, opts?: { limit?: number, fromId?: string, direction?: 'forward' | 'backward', paged?: boolean }) {
    // Use centralized naming function
    const s = SubjectPatterns.flowRun(flowId)
    const limit = opts?.limit ?? 200
    const direction = opts?.direction || 'backward'
    if (opts?.paged) {
      const page = await store.read(s, { limit: limit * 5, fromId: opts?.fromId, direction })
      const filtered = page.filter((r: any) => r?.kind === 'runner.log')
      const items = filtered.slice(0, limit)
      const nextFromId = page.length >= limit * 5 ? page[page.length - 1]?.id : undefined
      return { items, nextFromId }
    }
    const page = await store.read(s, { limit, fromId: opts?.fromId, direction })
    return page.filter((r: any) => r?.kind === 'runner.log').slice(0, limit)
  }

  async function publishLog(level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: any, ctx?: { queue?: string, jobId?: string, flowId?: string }) {
    // Split envelope meta (reserved) vs data.meta (free-form)
    const reserved = new Set(['flowId', 'flowName', 'stepName', 'stepRunId', 'stepId', 'attempt', 'jobId', 'queue', 'tags'])
    const envMeta: any = {}
    const dataMeta: any = {}
    const src = meta || {}
    for (const k of Object.keys(src)) {
      if (reserved.has(k)) envMeta[k] = src[k]
      else dataMeta[k] = src[k]
    }
    if (ctx?.flowId && envMeta.flowId == null) envMeta.flowId = ctx.flowId
    // v0.4: Emit log event with new schema
    const runId = ctx?.flowId || 'unknown'
    const flowName = envMeta.flowName || 'unknown'
    const stepName = envMeta.stepName
    const stepId = envMeta.stepId || envMeta.stepRunId
    const attempt = envMeta.attempt
    await eventManager.publishBus({
      type: 'log',
      runId,
      flowName,
      stepName,
      stepId,
      attempt,
      data: { level, message: msg, ...dataMeta },
    })
  }

  function onLog(handler: (e: { level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: any, raw: any }) => void) {
    return eventManager.onType('log', (evt: any) => {
      const d = (evt?.data || {}) as any
      handler({ level: d.level, msg: d.message || d.msg, meta: d.meta, raw: evt })
    })
  }

  /** Subscribe to logs on a specific job stream via the adapter-backed event manager. */
  function onJobLog(_jobId: string, _handler: (e: { level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: any, raw: any }) => void) {
    // No-op: job logs are not streamed via the stream store.
    return () => {}
  }

  /** Subscribe to logs on a specific flow run stream via the store adapter (canonical). */
  function onFlowLog(flowId: string, handler: (e: { level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: any, raw: any }) => void) {
    // Use centralized naming function
    const s = SubjectPatterns.flowRun(flowId)
    return store.subscribe(s, (evt: any) => {
      if (evt?.kind !== 'runner.log') return
      const d = (evt?.data || {}) as any
      handler({ level: d.level, msg: d.msg, meta: d.meta, raw: evt })
    })
  }

  return {
    getJobLogs,
    getFlowRunLogs,
    publishLog,
    onLog,
    onJobLog,
    onFlowLog,
  }
}
