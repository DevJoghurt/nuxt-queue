import { consola } from 'consola'
import type { LoggerOptions, LoggerProvider, LogLevel } from './contracts'

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

export class ConsoleLoggerProvider implements LoggerProvider {
  private base = consola.withTag('QUEUE')
  private opts: LoggerOptions
  private bindings?: Record<string, any>

  constructor(opts?: LoggerOptions, bindings?: Record<string, any>) {
    this.opts = opts || {}
    this.bindings = bindings
  }

  log(level: LogLevel, msg: string, meta?: any) {
    const m = redactMeta(meta, this.opts.redact)
    const payload = this.bindings ? { ...this.bindings, ...m } : m
    const l: any = this.base
    if (typeof l[level] === 'function') l[level](msg, payload)
    else l.log(`[${level}] ${msg}`, payload)
  }

  child(bindings?: Record<string, any>): LoggerProvider {
    const next = new ConsoleLoggerProvider(this.opts, { ...(this.bindings || {}), ...(bindings || {}) })
    return next
  }
}

export default ConsoleLoggerProvider
