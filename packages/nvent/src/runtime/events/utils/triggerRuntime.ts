import type { TriggerEntry, TriggerSubscription } from '../../../registry/types'
import type { StoreAdapter } from '../../adapters/interfaces/store'

/**
 * Runtime trigger state
 * Combines file-based config (auto-discovered) + programmatic (runtime)
 */
interface TriggerRuntimeState {
  // Trigger registry (from registerTrigger)
  triggers: Map<string, TriggerEntry>

  // Subscriptions: Trigger -> Flows
  triggerToFlows: Map<string, Set<TriggerSubscription>>

  // Reverse index: Flow -> Triggers
  flowToTriggers: Map<string, Set<string>>

  // Initialized flag
  initialized: boolean
}

/**
 * Centralized trigger runtime management
 * Handles runtime state, payload storage/resolution, and state manipulation
 *
 * This class is the single source of truth for trigger runtime state,
 * used by both useTrigger (public API) and triggerWiring (event orchestration)
 */
export class TriggerRuntime {
  private state: TriggerRuntimeState
  private store: StoreAdapter
  private logger: any

  constructor(store: StoreAdapter, logger: any) {
    this.store = store
    this.logger = logger
    this.state = {
      triggers: new Map(),
      triggerToFlows: new Map(),
      flowToTriggers: new Map(),
      initialized: false,
    }
  }

  // ============================================================================
  // State Access (Read-only)
  // ============================================================================

  get initialized(): boolean {
    return this.state.initialized
  }

  setInitialized(value: boolean): void {
    this.state.initialized = value
  }

  hasTrigger(name: string): boolean {
    return this.state.triggers.has(name)
  }

  getTrigger(name: string): TriggerEntry | undefined {
    return this.state.triggers.get(name)
  }

  getAllTriggers(options?: {
    sortBy?: 'registeredAt' | 'lastActivityAt' | 'name'
    order?: 'asc' | 'desc'
    limit?: number
    offset?: number
  }): TriggerEntry[] {
    let triggers = Array.from(this.state.triggers.values())

    // Apply sorting
    if (options?.sortBy) {
      triggers.sort((a, b) => {
        const aValue = a[options.sortBy!]
        const bValue = b[options.sortBy!]

        // Handle undefined values
        if (aValue === undefined && bValue === undefined) return 0
        if (aValue === undefined) return 1
        if (bValue === undefined) return -1

        // Compare values
        if (typeof aValue === 'string' && typeof bValue === 'string') {
          return options.order === 'desc'
            ? bValue.localeCompare(aValue)
            : aValue.localeCompare(bValue)
        }

        // Numeric comparison (timestamps)
        if (typeof aValue === 'number' && typeof bValue === 'number') {
          return options.order === 'desc' ? bValue - aValue : aValue - bValue
        }

        return 0
      })
    }

    // Apply pagination
    if (options?.offset !== undefined || options?.limit !== undefined) {
      const offset = options.offset || 0
      const limit = options.limit || triggers.length
      triggers = triggers.slice(offset, offset + limit)
    }

    return triggers
  }

  getSubscribedFlows(trigger: string): string[] {
    const subs = this.state.triggerToFlows.get(trigger) || new Set()
    // Deduplicate flow names in case of inconsistency
    return Array.from(new Set(Array.from(subs).map(s => s.flowName)))
  }

  getFlowTriggers(flow: string): string[] {
    return Array.from(this.state.flowToTriggers.get(flow) || new Set())
  }

  getSubscription(trigger: string, flow: string): TriggerSubscription | undefined {
    const subs = this.state.triggerToFlows.get(trigger)
    if (!subs) return undefined
    return Array.from(subs).find(s => s.flowName === flow)
  }

  getAllSubscriptions(): TriggerSubscription[] {
    const allSubs: TriggerSubscription[] = []
    for (const subs of this.state.triggerToFlows.values()) {
      allSubs.push(...Array.from(subs))
    }
    return allSubs
  }

  getRuntimeStats() {
    return {
      triggerCount: this.state.triggers.size,
      subscriptionCount: Array.from(this.state.triggerToFlows.values())
        .reduce((acc, subs) => acc + subs.size, 0),
      flowCount: this.state.flowToTriggers.size,
      initialized: this.state.initialized,
    }
  }

  // ============================================================================
  // State Manipulation (Internal)
  // ============================================================================

  addTrigger(name: string, entry: TriggerEntry): void {
    this.state.triggers.set(name, entry)
  }

  removeTrigger(name: string): void {
    this.state.triggers.delete(name)
    this.state.triggerToFlows.delete(name)

    // Clean up reverse index
    for (const [flow, triggers] of this.state.flowToTriggers.entries()) {
      triggers.delete(name)
      if (triggers.size === 0) {
        this.state.flowToTriggers.delete(flow)
      }
    }
  }

  addSubscription(
    triggerName: string,
    flowName: string,
    subscription: TriggerSubscription,
  ): void {
    // Add to trigger -> flows index
    if (!this.state.triggerToFlows.has(triggerName)) {
      this.state.triggerToFlows.set(triggerName, new Set())
    }

    const triggerSubs = this.state.triggerToFlows.get(triggerName)!

    // Remove existing subscription for this flow to prevent duplicates
    const existingSub = Array.from(triggerSubs).find(s => s.flowName === flowName)
    if (existingSub) {
      triggerSubs.delete(existingSub)
    }

    // Add the new/updated subscription
    triggerSubs.add(subscription)

    // Add to flow -> triggers reverse index
    if (!this.state.flowToTriggers.has(flowName)) {
      this.state.flowToTriggers.set(flowName, new Set())
    }
    this.state.flowToTriggers.get(flowName)!.add(triggerName)
  }

  removeSubscription(triggerName: string, flowName: string): void {
    // Remove from trigger -> flows index
    const triggerSubs = this.state.triggerToFlows.get(triggerName)
    if (triggerSubs) {
      const subToRemove = Array.from(triggerSubs).find(s => s.flowName === flowName)
      if (subToRemove) {
        triggerSubs.delete(subToRemove)
        if (triggerSubs.size === 0) {
          this.state.triggerToFlows.delete(triggerName)
        }
      }
    }

    // Remove from flow -> triggers reverse index
    const flowTriggers = this.state.flowToTriggers.get(flowName)
    if (flowTriggers) {
      flowTriggers.delete(triggerName)
      if (flowTriggers.size === 0) {
        this.state.flowToTriggers.delete(flowName)
      }
    }
  }

  // ============================================================================
  // Payload Management
  // ============================================================================

  /**
   * Extract a minimal summary from payload for debugging
   * Keeps only small, identifying fields
   */
  private extractSummary(data: any, maxDepth = 2): any {
    if (maxDepth === 0) return '[nested]'

    if (Array.isArray(data)) {
      return {
        __type: 'array',
        length: data.length,
        sample: data.length > 0 ? this.extractSummary(data[0], maxDepth - 1) : null,
      }
    }

    if (data && typeof data === 'object') {
      const summary: any = {}
      for (const [key, val] of Object.entries(data)) {
        if (typeof val === 'string' && val.length > 100) {
          summary[key] = `${val.slice(0, 100)}... (${val.length} chars)`
        }
        else if (typeof val === 'object' && val !== null) {
          summary[key] = this.extractSummary(val, maxDepth - 1)
        }
        else {
          summary[key] = val
        }
      }
      return summary
    }

    return data
  }

  /**
   * Store large payload in KV store and return reference
   * Returns either the original data (if small) or a reference object
   */
  async handleLargePayload(
    triggerName: string,
    data: any,
    threshold: number,
  ): Promise<any> {
    const serialized = JSON.stringify(data)
    const sizeBytes = new TextEncoder().encode(serialized).length

    // If small enough, return as-is
    if (sizeBytes < threshold) {
      return data
    }

    // Large payload: store in KV with TTL
    const payloadId = `payload:${triggerName}:${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    const ttl = 7 * 24 * 60 * 60 // 7 days in seconds

    await this.store.kv.set(payloadId, data, ttl)

    this.logger.debug('Stored large payload in KV', {
      triggerName,
      payloadId,
      originalSize: sizeBytes,
      threshold,
    })

    // Return reference with summary
    return {
      __payloadRef: payloadId,
      __size: sizeBytes,
      __summary: this.extractSummary(data),
    }
  }

  /**
   * Resolve payload reference if needed
   * Returns the full payload from KV store, or falls back to summary if expired
   */
  async resolvePayload(data: any): Promise<any> {
    if (data?.__payloadRef) {
      const payload = await this.store.kv.get(data.__payloadRef)

      if (!payload) {
        this.logger.warn('Payload reference expired or not found, using summary', {
          ref: data.__payloadRef,
        })
        return data.__summary || {}
      }

      return payload
    }

    return data
  }
}

/**
 * Singleton instance
 */
let instance: TriggerRuntime | null = null

/**
 * Get or create the singleton TriggerRuntime instance
 */
export function getTriggerRuntime(store: StoreAdapter, logger: any): TriggerRuntime {
  if (!instance) {
    instance = new TriggerRuntime(store, logger)
  }
  return instance
}
