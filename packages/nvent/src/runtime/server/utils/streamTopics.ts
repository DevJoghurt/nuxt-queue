/**
 * Stream topic naming utilities
 *
 * Standardized topic patterns for StreamAdapter pub/sub
 * These match the topics published by StoreAdapter mutations
 */

/**
 * Get topic for store append events
 * Pattern: store:append:{subject}
 * Published when: StoreAdapter.append() adds an event to a subject
 */
export function getStoreAppendTopic(subject: string): string {
  return `store:append:${subject}`
}

/**
 * Get topic for store save events
 * Pattern: store:save:{collection}
 * Published when: StoreAdapter.save() creates/updates a document
 */
export function getStoreSaveTopic(collection: string): string {
  return `store:save:${collection}`
}

/**
 * Get topic for store delete events
 * Pattern: store:delete:{collection}
 * Published when: StoreAdapter.delete() removes a document
 */
export function getStoreDeleteTopic(collection: string): string {
  return `store:delete:${collection}`
}

/**
 * Get topic for KV store events
 * Pattern: store:kv:{key}
 * Published when: StoreAdapter.kvSet() updates a key
 */
export function getStoreKvTopic(key: string): string {
  return `store:kv:${key}`
}

/**
 * Common subject patterns for event streams
 */
export const SubjectPatterns = {
  /**
   * Flow run event stream subject
   */
  flowRun: (runId: string) => `nq:flow:${runId}`,

  /**
   * Flow run index (sorted set of runs by flow name)
   */
  flowRunIndex: (flowName: string) => `nq:flows:${flowName}`,

  /**
   * Flow definition subject
   */
  flowDefinition: (flowName: string) => `flow-def:${flowName}`,

  /**
   * Worker heartbeat subject
   */
  workerHeartbeat: (workerId: string) => `worker:${workerId}`,
} as const
