import type { WorkerEntry, TriggerSubscription } from './types'

/**
 * Analyze workers to extract trigger subscriptions
 * Called during build to create trigger subscription index
 */
export function analyzeTriggerSubscriptions(
  workers: WorkerEntry[],
): TriggerSubscription[] {
  const subscriptions: TriggerSubscription[] = []

  for (const worker of workers) {
    if (!worker.flow?.triggers?.subscribe) continue

    const flowNames = Array.isArray(worker.flow.names)
      ? worker.flow.names
      : [worker.flow.names]

    // Subscribe each flow name to the triggers
    for (const flowName of flowNames) {
      for (const triggerName of worker.flow.triggers.subscribe) {
        subscriptions.push({
          triggerName,
          flowName,
          mode: worker.flow.triggers.mode || 'auto',
          source: 'config',
          registeredAt: new Date().toISOString(),
        })
      }
    }
  }

  return subscriptions
}

/**
 * Build bidirectional trigger index
 * Creates efficient lookup maps for trigger -> flows and flow -> triggers
 */
export function buildTriggerIndex(
  subscriptions: TriggerSubscription[],
): {
  triggerToFlows: Map<string, Set<string>>
  flowToTriggers: Map<string, Set<string>>
} {
  const triggerToFlows = new Map<string, Set<string>>()
  const flowToTriggers = new Map<string, Set<string>>()

  for (const sub of subscriptions) {
    // Trigger -> Flows
    if (!triggerToFlows.has(sub.triggerName)) {
      triggerToFlows.set(sub.triggerName, new Set())
    }
    triggerToFlows.get(sub.triggerName)!.add(sub.flowName)

    // Flow -> Triggers
    if (!flowToTriggers.has(sub.flowName)) {
      flowToTriggers.set(sub.flowName, new Set())
    }
    flowToTriggers.get(sub.flowName)!.add(sub.triggerName)
  }

  return { triggerToFlows, flowToTriggers }
}

/**
 * Validate trigger subscriptions
 * Checks for common configuration issues
 */
export function validateTriggerSubscriptions(
  subscriptions: TriggerSubscription[],
  logger?: { warn: (...args: any[]) => void },
): {
  orphanedTriggers: string[]
  duplicateSubscriptions: string[]
} {
  const orphanedTriggers: string[] = []
  const duplicateSubscriptions: string[] = []
  const seen = new Set<string>()

  for (const sub of subscriptions) {
    const key = `${sub.triggerName}:${sub.flowName}`

    // Check for duplicates
    if (seen.has(key)) {
      duplicateSubscriptions.push(key)
      logger?.warn(
        `Duplicate subscription: flow '${sub.flowName}' subscribes to `
        + `trigger '${sub.triggerName}' multiple times`,
      )
    }
    seen.add(key)
  }

  return { orphanedTriggers, duplicateSubscriptions }
}
