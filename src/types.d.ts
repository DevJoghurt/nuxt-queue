export interface ModuleOptions {
  dir?: string
  runtimeDir?: string
  ui?: boolean
  redis?: RedisOptions
  debug?: Record<string, any>
}
