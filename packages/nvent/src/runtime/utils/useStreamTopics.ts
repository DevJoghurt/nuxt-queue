/**
 * Stream topic naming utilities
 *
 * Standardized topic patterns for StreamAdapter pub/sub
 * These match the topics published by StoreAdapter mutations and wiring coordinators
 */

/**
 * Get topic for store append events
 * Pattern: store:append:{subject}
 * Published when: StoreAdapter.append() adds an event to a subject
 * Used by: StreamCoordinator (store-sync channel)
 */
function getStoreAppendTopic(subject: string): string {
  return `store:append:${subject}`
}

/**
 * Get topic for store save events
 * Pattern: store:save:{collection}
 * Published when: StoreAdapter.save() creates/updates a document
 */
function getStoreSaveTopic(collection: string): string {
  return `store:save:${collection}`
}

/**
 * Get topic for store delete events
 * Pattern: store:delete:{collection}
 * Published when: StoreAdapter.delete() removes a document
 */
function getStoreDeleteTopic(collection: string): string {
  return `store:delete:${collection}`
}

/**
 * Get topic for KV store events
 * Pattern: store:kv:{key}
 * Published when: StoreAdapter.kvSet() updates a key
 */
function getStoreKvTopic(key: string): string {
  return `store:kv:${key}`
}

/**
 * Get topic for flow orchestration events
 * Pattern: flow:event:{runId}
 * Published when: StreamCoordinator flow-events channel publishes flow lifecycle events
 * Used by: Future trigger system for cross-instance coordination
 */
function getFlowEventTopic(runId: string): string {
  return `flow:event:${runId}`
}

/**
 * Get topic for client messages (WebSocket/SSE)
 * Pattern: client:flow:{runId}
 * Published when: StreamCoordinator client-messages channel publishes UI updates
 * Used by: WebSocket handler for real-time UI updates
 */
function getClientFlowTopic(runId: string): string {
  return `client:flow:${runId}`
}

/**
 * Common subject patterns for event streams
 */
const SubjectPatterns = {
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

export function useStreamTopics() {
  return {
    getStoreAppendTopic,
    getStoreSaveTopic,
    getStoreDeleteTopic,
    getStoreKvTopic,
    getFlowEventTopic,
    getClientFlowTopic,
    SubjectPatterns,
  }
}
