import type { AwaitConfig } from '../../../registry/types'
import {
  registerAwaitPattern,
  resolveAwaitPattern,
  registerWebhookAwait,
  resolveWebhookAwait,
  registerEventAwait,
  resolveEventAwait,
  registerScheduleAwait,
  resolveScheduleAwait,
  registerTimeAwait,
  resolveTimeAwait,
} from './awaitPatterns'

/**
 * Await pattern composable
 * Provides unified API for registering and resolving await patterns
 */
export function useAwait() {
  return {
    /**
     * Register an await pattern based on config type
     * Automatically routes to appropriate implementation
     */
    register: registerAwaitPattern,

    /**
     * Resolve an await pattern by type
     */
    resolve: resolveAwaitPattern,

    /**
     * Direct access to specific await pattern implementations
     */
    webhook: {
      register: registerWebhookAwait,
      resolve: resolveWebhookAwait,
    },
    event: {
      register: registerEventAwait,
      resolve: resolveEventAwait,
    },
    schedule: {
      register: registerScheduleAwait,
      resolve: resolveScheduleAwait,
    },
    time: {
      register: registerTimeAwait,
      resolve: resolveTimeAwait,
    },
  }
}

// Export types for convenience
export type { AwaitConfig }
