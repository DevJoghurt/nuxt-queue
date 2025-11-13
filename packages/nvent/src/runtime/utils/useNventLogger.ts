import { useRuntimeConfig } from '#imports'
import { consola, type ConsolaInstance } from 'consola'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface NventLogger {
  debug: (message: string, context?: any) => void
  info: (message: string, context?: any) => void
  warn: (message: string, context?: any) => void
  error: (message: string, context?: any) => void
  log: (level: LogLevel, message: string, context?: any) => void
  isEnabled: (level: LogLevel) => boolean
  consola: ConsolaInstance
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

// Cache logger instances per scope
const loggerCache = new Map<string, ConsolaInstance>()

/**
 * Creates a contextual server logger with configurable log levels
 * Uses consola for beautiful, styled console output with colors and icons
 *
 * Configuration via runtime config or environment variables:
 * - queue.debug.level: 'debug' | 'info' | 'warn' | 'error' | 'silent'
 * - queue.debug.<scope>: boolean (enables debug logging for specific scope)
 * - NQ_DEBUG_LEVEL: environment variable override
 * - NQ_DEBUG_<SCOPE>: environment variable for scope (e.g., NQ_DEBUG_FLOW_WIRING=1)
 *
 * @param scope - Logger scope/namespace (e.g., 'flow-wiring', 'event-manager')
 * @returns NventLogger instance with scoped logging methods
 *
 * @example
 * ```ts
 * const logger = useNventLogger('flow-wiring')
 * logger.debug('Step triggered', { stepName: 'process', runId: '123' })
 * logger.info('Flow completed', { flowName: 'example' })
 * logger.warn('Retry attempt', { attempt: 3 })
 * logger.error('Processing failed', { error: err.message })
 *
 * // Access consola instance for advanced features
 * logger.consola.success('All steps completed!')
 * logger.consola.box('🚀 Flow Started')
 * ```
 */
export function useNventLogger(scope: string): NventLogger {
  const rc = useRuntimeConfig()

  // Get global log level from config or env
  const debugConfig = rc?.queue?.debug as Record<string, any> | undefined
  const configLevel = debugConfig?.level || process.env.NQ_DEBUG_LEVEL || 'info'
  const globalLevelNum = configLevel === 'silent' ? Infinity : LOG_LEVELS[configLevel as LogLevel] ?? LOG_LEVELS.info

  // Check if this scope is specifically enabled for debug logging
  const scopeKey = scope.replace(/[^a-z0-9]/gi, '_').toLowerCase()
  const envKey = `NQ_DEBUG_${scopeKey.toUpperCase()}`
  const isScopeDebugEnabled = debugConfig?.[scopeKey] === true || process.env[envKey] === '1'

  // Get or create cached consola instance for this scope
  let scopedConsola = loggerCache.get(scope)
  if (!scopedConsola) {
    scopedConsola = consola.withTag(scope)
    loggerCache.set(scope, scopedConsola)
  }

  // Use non-null assertion since we know it's defined after the check
  const logger = scopedConsola!

  function isEnabled(level: LogLevel): boolean {
    const levelNum = LOG_LEVELS[level]

    // If scope debug is explicitly enabled, allow all debug logs for this scope
    if (isScopeDebugEnabled && level === 'debug') {
      return true
    }

    // Otherwise check against global level
    return levelNum >= globalLevelNum
  }

  function log(level: LogLevel, message: string, context?: any): void {
    if (!isEnabled(level)) return

    // Format message with context if provided
    if (context && Object.keys(context).length > 0) {
      logger[level](message, context)
    }
    else {
      logger[level](message)
    }
  }

  return {
    debug: (message: string, context?: any) => log('debug', message, context),
    info: (message: string, context?: any) => log('info', message, context),
    warn: (message: string, context?: any) => log('warn', message, context),
    error: (message: string, context?: any) => log('error', message, context),
    log,
    isEnabled,
    consola: logger,
  }
}

/**
 * Type guard to check if debug logging is enabled for any scope
 */
export function isDebugEnabled(): boolean {
  const rc = useRuntimeConfig()
  const debugConfig = rc?.queue?.debug as Record<string, any> | undefined
  const level = debugConfig?.level || process.env.NQ_DEBUG_LEVEL
  return level === 'debug' || Object.keys(debugConfig || {}).some(key => key !== 'level')
}
