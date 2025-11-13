/**
 * Adapter Interfaces
 *
 * Three types of adapters for nvent:
 * - QueueAdapter: Job execution infrastructure
 * - StreamAdapter: Cross-instance pub/sub messaging
 * - StoreAdapter: Three-tier storage (events, documents, key-value)
 */

export * from './queue'
export * from './stream'
export * from './store'
