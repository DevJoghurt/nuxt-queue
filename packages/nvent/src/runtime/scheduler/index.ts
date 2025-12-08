/**
 * Scheduler Factory and Composable
 *
 * Provides a unified scheduler interface for the entire application.
 * Uses Scheduler with store adapter (supports both distributed and single-instance modes).
 */

import { Scheduler } from './scheduler'
import type { SchedulerAdapter } from './types'
import { useRuntimeConfig } from '#imports'

// Use globalThis to ensure singleton survives HMR reloads when used as npm package
const SCHEDULER_KEY = '__nvent_scheduler__'
let schedulerInstance: SchedulerAdapter | null = (globalThis as any)[SCHEDULER_KEY] || null

/**
 * Create a scheduler instance
 * Uses Scheduler which adapts based on store capabilities:
 * - With indexAdd/indexGet: Full distributed locking
 * - Without: Degrades gracefully to KV-based locking (single instance)
 */
export function createScheduler(store: any): SchedulerAdapter {
  const config = useRuntimeConfig()
  const prefix = config.nvent.store?.prefix || 'nvent'
  const useIndexLocking = !!(store.indexAdd && store.index.get)

  return new Scheduler({
    store,
    keyPrefix: `${prefix}:scheduler`,
    lockTTL: 300000, // 5 minutes
    useIndexLocking,
  })
}

/**
 * Get the global scheduler instance
 * Must be initialized first with initializeScheduler()
 */
export function useScheduler(): SchedulerAdapter {
  if (!schedulerInstance) {
    throw new Error('Scheduler not initialized. Call initializeScheduler() first.')
  }

  return schedulerInstance
}

/**
 * Initialize the scheduler
 * Should be called once during app startup
 */
export async function initializeScheduler(store: any): Promise<SchedulerAdapter> {
  if (schedulerInstance) {
    return schedulerInstance
  }

  schedulerInstance = createScheduler(store)
  ;(globalThis as any)[SCHEDULER_KEY] = schedulerInstance
  await schedulerInstance.start()

  return schedulerInstance
}

/**
 * Shutdown the scheduler
 * Should be called during app shutdown
 */
export async function shutdownScheduler(): Promise<void> {
  if (schedulerInstance) {
    await schedulerInstance.stop()
    schedulerInstance = null
    ;(globalThis as any)[SCHEDULER_KEY] = null
  }
}

/**
 * Reset the scheduler instance (for testing)
 */
export function resetScheduler(): void {
  schedulerInstance = null
  ;(globalThis as any)[SCHEDULER_KEY] = null
}
