import { useEventManager } from '#imports'

export interface LogReadOptions {
  fromId?: string
  limit?: number
}

export function useLogs() {
  const eventManager = useEventManager()
  const streams = eventManager.getStreamNames()

  async function readJobLogs(jobId: string, opts?: LogReadOptions) {
    const s = typeof streams.job === 'function' ? streams.job(String(jobId)) : String(streams.job) + String(jobId)
    const recs = await eventManager.read({ stream: s, limit: opts?.limit, fromId: opts?.fromId, filter: (r: any) => r?.kind === 'runner.log' })
    return Array.isArray(recs) ? recs : recs.items
  }

  async function readFlowRunLogs(runId: string, opts?: LogReadOptions) {
    const s = typeof streams.flow === 'function' ? streams.flow(String(runId)) : String(streams.flow) + String(runId)
    const recs = await eventManager.read({ stream: s, limit: opts?.limit, fromId: opts?.fromId, filter: (r: any) => r?.kind === 'runner.log' })
    return Array.isArray(recs) ? recs : recs.items
  }

  /**
   * Unified logs reader for a job stream.
   * - When opts.paged is true, returns { items, nextFromId }
   * - Otherwise returns an array of events
   */
  async function getJobLogs(jobId: string, opts?: { limit?: number, fromId?: string, direction?: 'forward' | 'backward', paged?: boolean }) {
    const s = typeof streams.job === 'function' ? streams.job(String(jobId)) : String(streams.job) + String(jobId)
    const res = await eventManager.read({
      stream: s,
      limit: opts?.limit ?? 200,
      fromId: opts?.fromId,
      direction: opts?.direction || 'backward',
      filter: (r: any) => r?.kind === 'runner.log',
      paged: !!opts?.paged,
    }) as any
    return res
  }

  /**
   * Unified logs reader for a flow run stream.
   * - When opts.paged is true, returns { items, nextFromId }
   * - Otherwise returns an array of events
   */
  async function getFlowRunLogs(runId: string, opts?: { limit?: number, fromId?: string, direction?: 'forward' | 'backward', paged?: boolean }) {
    const s = typeof streams.flow === 'function' ? streams.flow(String(runId)) : String(streams.flow) + String(runId)
    const res = await eventManager.read({
      stream: s,
      limit: opts?.limit ?? 200,
      fromId: opts?.fromId,
      direction: opts?.direction || 'backward',
      filter: (r: any) => r?.kind === 'runner.log',
      paged: !!opts?.paged,
    }) as any
    return res
  }

  async function publishLog(level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: any, ctx?: { queue?: string, jobId?: string, flowId?: string }) {
    await eventManager.publish({ kind: 'runner.log', data: { level, msg, meta } }, ctx)
  }

  function onLog(handler: (e: { level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: any, raw: any }) => void) {
    return eventManager.onKind('runner.log', (evt: any) => {
      const d = (evt?.data || {}) as any
      handler({ level: d.level, msg: d.msg, meta: d.meta, raw: evt })
    })
  }

  /** Subscribe to logs on a specific job stream via the adapter-backed event manager. */
  function onJobLog(jobId: string, handler: (e: { level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: any, raw: any }) => void) {
    const s = typeof streams.job === 'function' ? streams.job(String(jobId)) : String(streams.job) + String(jobId)
    return eventManager.subscribeStream(s, (evt: any) => {
      if (evt?.kind !== 'runner.log') return
      const d = (evt?.data || {}) as any
      handler({ level: d.level, msg: d.msg, meta: d.meta, raw: evt })
    })
  }

  /** Subscribe to logs on a specific flow run stream via the adapter-backed event manager. */
  function onFlowLog(runId: string, handler: (e: { level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: any, raw: any }) => void) {
    const s = typeof streams.flow === 'function' ? streams.flow(String(runId)) : String(streams.flow) + String(runId)
    return eventManager.subscribeStream(s, (evt: any) => {
      if (evt?.kind !== 'runner.log') return
      const d = (evt?.data || {}) as any
      handler({ level: d.level, msg: d.msg, meta: d.meta, raw: evt })
    })
  }

  return {
    readJobLogs,
    readFlowRunLogs,
    getJobLogs,
    getFlowRunLogs,
    publishLog,
    onLog,
    onJobLog,
    onFlowLog,
  }
}
