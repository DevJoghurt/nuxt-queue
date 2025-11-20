/**
 * Lifecycle hooks registry for await patterns
 * v0.5 - Await Integration
 */

export interface LifecycleHooks {
  /**
   * Called when await pattern is registered
   * @param webhookUrl - Generated webhook URL (for webhook awaits) or event/schedule info
   * @param stepData - Current step data
   * @param ctx - Worker context
   */
  onAwaitRegister?: (
    webhookUrl: string,
    stepData: any,
    ctx: any,
  ) => Promise<void>

  /**
   * Called when await pattern is resolved
   * @param resolvedData - Data from the trigger that resolved the await
   * @param stepData - Current step data
   * @param ctx - Worker context
   */
  onAwaitResolve?: (
    resolvedData: any,
    stepData: any,
    ctx: any,
  ) => Promise<void>
}

const hookRegistry = new Map<string, LifecycleHooks>()

export function useHookRegistry() {
  return {
    /**
     * Register lifecycle hooks for a specific flow step
     */
    register(flowName: string, stepName: string, hooks: LifecycleHooks) {
      const key = `${flowName}:${stepName}`
      hookRegistry.set(key, hooks)
    },

    /**
     * Load lifecycle hooks for a specific flow step
     */
    load(flowName: string, stepName: string): LifecycleHooks | null {
      const key = `${flowName}:${stepName}`
      return hookRegistry.get(key) || null
    },

    /**
     * Clear all registered hooks (useful for testing)
     */
    clear() {
      hookRegistry.clear()
    },
  }
}
