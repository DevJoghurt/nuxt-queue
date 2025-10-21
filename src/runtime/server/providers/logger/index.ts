import { useRuntimeConfig } from '#imports'
import type { LoggerProvider, LoggerOptions } from './contracts'
import { ConsoleLoggerProvider } from './console'
import { BullMqLoggerProvider } from './bullmq'

let current: LoggerProvider | null = null

export function useLoggerProvider(): LoggerProvider {
  if (current) return current
  const rc: any = useRuntimeConfig()
  const cfg = rc?.queue?.logger || { name: 'console', level: 'info' }
  const opts: LoggerOptions = { level: cfg.level, redact: cfg.redact, tags: cfg.tags }
  // Switch by cfg.name
  if (cfg.name === 'redis') current = new BullMqLoggerProvider(opts)
  else current = new ConsoleLoggerProvider(opts)
  return current
}

export function setLoggerProvider(p: LoggerProvider) {
  current = p
}

export default useLoggerProvider
