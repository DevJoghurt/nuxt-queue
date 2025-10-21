import { $useEventStoreProvider, $useStreamNames } from '#imports'

export interface LogReadOptions {
  fromId?: string
  limit?: number
}

async function readJobLogs(jobId: string, opts?: LogReadOptions) {
  const streams = $useStreamNames() as any
  const s = typeof streams.job === 'function' ? streams.job(String(jobId)) : String(streams.job) + String(jobId)
  const store = $useEventStoreProvider()
  const recs = await store.read(s, opts)
  return (recs || []).filter(r => r?.kind === 'runner.log')
}

async function readFlowRunLogs(runId: string, opts?: LogReadOptions) {
  const streams = $useStreamNames() as any
  const s = typeof streams.flow === 'function' ? streams.flow(String(runId)) : String(streams.flow) + String(runId)
  const store = $useEventStoreProvider()
  const recs = await store.read(s, opts)
  return (recs || []).filter(r => r?.kind === 'runner.log')
}

export function useLogs() {
  return {
    readJobLogs,
    readFlowRunLogs,
  }
}
