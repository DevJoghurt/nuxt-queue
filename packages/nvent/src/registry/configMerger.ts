import defu from 'defu'
import type { WorkerEntry } from './types'

/**
 * Configuration from nuxt.config.ts
 */
export interface DefaultConfigs {
  queue?: {
    defaultJobOptions?: any
    prefix?: string
    limiter?: any
  }
  worker?: {
    concurrency?: number
    lockDurationMs?: number
    maxStalledCount?: number
    drainDelayMs?: number
    autorun?: boolean
    pollingIntervalMs?: number
  }
}

/**
 * Merge default configurations from nuxt.config with per-worker defineQueueConfig.
 * Per-worker config takes priority over defaults.
 *
 * @param worker - Worker entry from registry scan
 * @param defaults - Default configs from nuxt.config
 * @returns Worker entry with merged configurations
 */
export function mergeWorkerConfig(worker: WorkerEntry, defaults: DefaultConfigs): WorkerEntry {
  const merged = { ...worker }

  // Merge queue config: worker config > defaults
  if (defaults.queue || worker.queue) {
    merged.queue = defu(
      worker.queue || {},
      defaults.queue || {},
    ) as WorkerEntry['queue']
  }

  // Merge worker config: worker config > defaults
  if (defaults.worker || worker.worker) {
    merged.worker = defu(
      worker.worker || {},
      defaults.worker || {},
    )
  }

  return merged
}

/**
 * Merge default configurations into all workers in the registry.
 *
 * @param workers - Array of worker entries
 * @param defaults - Default configs from nuxt.config
 * @returns Array of worker entries with merged configurations
 */
export function mergeAllWorkerConfigs(workers: WorkerEntry[], defaults: DefaultConfigs): WorkerEntry[] {
  return workers.map(worker => mergeWorkerConfig(worker, defaults))
}
