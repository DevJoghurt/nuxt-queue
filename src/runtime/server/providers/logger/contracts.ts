export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LoggerProvider {
  log(level: LogLevel, msg: string, meta?: any): void
  child(bindings?: Record<string, any>): LoggerProvider
}

export interface LoggerOptions {
  level?: LogLevel
  tags?: string[]
  redact?: string[]
}
