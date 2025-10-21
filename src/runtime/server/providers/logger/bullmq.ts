import type { LoggerOptions, LoggerProvider, LogLevel } from './contracts'
import { $useEventStoreProvider, $useEventBus, $useStreamNames, useRuntimeConfig } from '#imports'
import { Queue } from 'bullmq'

function redactMeta(meta: any, redact: string[] = []): any {
  if (!meta || !redact.length) return meta
  try {
    const clone = JSON.parse(JSON.stringify(meta))
    for (const path of redact) {
      const parts = path.split('.')
      let obj = clone as any
      for (let i = 0; i < parts.length - 1; i++) {
        if (!obj || typeof obj !== 'object') break
        obj = obj[parts[i]]
      }
      const last = parts[parts.length - 1]
      if (obj && typeof obj === 'object' && last in obj) obj[last] = '[REDACTED]'
    }
    return clone
  }
  catch {
    return meta
  }
}

export class BullMqLoggerProvider implements LoggerProvider {
  private opts: LoggerOptions
  private bindings?: Record<string, any>
  private queues = new Map<string, Queue>()

  constructor(opts?: LoggerOptions, bindings?: Record<string, any>) {
    this.opts = opts || {}
    this.bindings = bindings
  }

  child(bindings?: Record<string, any>): LoggerProvider {
    return new BullMqLoggerProvider(this.opts, { ...(this.bindings || {}), ...(bindings || {}) })
  }

  async log(level: LogLevel, msg: string, meta?: any) {
    const data = {
      level,
      msg,
      meta: redactMeta(meta, this.opts.redact),
      ...(this.bindings || {}),
    }

    // Append to streams using configured stream names (durable, cross-provider)
    try {
      const streamsCfg = $useStreamNames()
      const store = $useEventStoreProvider()
      const { publish } = $useEventBus()

      const subject = (this.bindings?.queue as string) || (this.bindings?.subject as string) || undefined
      const jobId = (this.bindings?.jobId as string) || undefined
      const traceId = (this.bindings?.traceId as string) || undefined
      const streams = [
        streamsCfg.global,
        subject ? (typeof (streamsCfg as any).queue === 'function' ? (streamsCfg as any).queue(subject) : String((streamsCfg as any).queue) + String(subject)) : null,
        jobId ? (typeof (streamsCfg as any).job === 'function' ? (streamsCfg as any).job(jobId) : String((streamsCfg as any).job) + String(jobId)) : null,
        traceId ? (typeof (streamsCfg as any).flow === 'function' ? (streamsCfg as any).flow(traceId) : String((streamsCfg as any).flow) + String(traceId)) : null,
      ].filter(Boolean) as string[]

      const base = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        ts: new Date().toISOString(),
        kind: 'runner.log',
        subject,
        data,
        meta: undefined,
        correlationId: traceId,
        causationId: jobId,
        v: 1,
      }
      for (const s of streams) {
        const rec = await store.append(s, base)
        publish(rec)
      }
    }
    catch {
      // ignore persistence errors to avoid breaking the app on logging
    }

    // Also write to BullMQ job logs if configured and context available
    try {
      const subject = (this.bindings?.queue as string) || undefined
      const jobId = (this.bindings?.jobId as string) || undefined
      if (!subject || !jobId) return
      const rc: any = useRuntimeConfig()
      const enabled = rc?.queue?.logger?.bullmq?.writeJobLogs
      // default to true when not explicitly false
      if (enabled === false) return
      const q = this.getQueue(subject, rc?.queue?.redis)
      const job = await q.getJob(jobId)
      if (job) {
        const line = this.formatLine(level, msg, data?.meta)
        await job.log(line)
      }
    }
    catch {
      // ignore bullmq job log failures
    }
  }

  private getQueue(name: string, connection?: any): Queue {
    const cached = this.queues.get(name)
    if (cached) return cached
    const q = new Queue(name, { connection })
    this.queues.set(name, q)
    return q
  }

  private formatLine(level: LogLevel, msg: string, meta?: any): string {
    const base = `[${new Date().toISOString()}] ${level.toUpperCase()}: ${msg}`
    if (meta == null) return base
    try {
      return `${base} ${JSON.stringify(meta)}`
    }
    catch {
      return base
    }
  }
}

export default BullMqLoggerProvider
