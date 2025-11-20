import { useStoreAdapter, useNventLogger, useStreamTopics } from '#imports'
import { useTrigger } from '../../nitro/utils/useTrigger'

export interface TriggerCleanupOptions {
  /**
   * Retire triggers with no subscribers after N days of inactivity
   * @default 30
   */
  retireAfterDays?: number

  /**
   * Delete retired trigger streams after N days
   * Note: Stream deletion may not be supported by all adapters
   * @default 90
   */
  deleteStreamsAfterDays?: number

  /**
   * Dry run mode - log actions without executing them
   * @default false
   */
  dryRun?: boolean

  /**
   * Only retire triggers matching this pattern (regex string)
   */
  triggerPattern?: string
}

export interface TriggerCleanupResult {
  triggersRetired: string[]
  streamsDeleted: string[]
  errors: Array<{ trigger: string, error: string }>
  dryRun: boolean
}

/**
 * Clean up inactive and retired triggers
 * Part of trigger index + stream architecture (v0.5.1)
 */
export async function cleanupTriggers(
  opts: TriggerCleanupOptions = {},
): Promise<TriggerCleanupResult> {
  const {
    retireAfterDays = 30,
    deleteStreamsAfterDays = 90,
    dryRun = false,
    triggerPattern,
  } = opts

  const store = useStoreAdapter()
  const logger = useNventLogger('trigger-cleanup')
  const trigger = useTrigger()
  const { SubjectPatterns } = useStreamTopics()

  const result: TriggerCleanupResult = {
    triggersRetired: [],
    streamsDeleted: [],
    errors: [],
    dryRun,
  }

  const now = Date.now()
  const retireThreshold = now - (retireAfterDays * 24 * 60 * 60 * 1000)
  const deleteThreshold = now - (deleteStreamsAfterDays * 24 * 60 * 60 * 1000)

  logger.info('Starting trigger cleanup', {
    retireAfterDays,
    deleteStreamsAfterDays,
    dryRun,
    triggerPattern,
  })

  // Check if store supports index operations
  if (!store.indexRead) {
    logger.warn('Store does not support indexRead, cannot perform cleanup')
    return result
  }

  const indexKey = SubjectPatterns.triggerIndex()
  const entries = await store.indexRead(indexKey, { limit: 10000 })

  const patternRegex = triggerPattern ? new RegExp(triggerPattern) : null

  for (const entry of entries) {
    const triggerName = entry.id
    const metadata = entry.metadata as any

    // Skip if pattern doesn't match
    if (patternRegex && !patternRegex.test(triggerName)) {
      continue
    }

    try {
      // Check for retirement candidates
      if (
        metadata.status === 'active'
        && (metadata.stats?.activeSubscribers === 0 || !metadata.subscriptions || Object.keys(metadata.subscriptions).length === 0)
        && metadata.lastActivityAt
      ) {
        const lastActivityTimestamp = new Date(metadata.lastActivityAt).getTime()

        if (lastActivityTimestamp < retireThreshold) {
          const inactiveDays = Math.floor((now - lastActivityTimestamp) / (24 * 60 * 60 * 1000))
          logger.info(`Retiring inactive trigger: ${triggerName} (inactive for ${inactiveDays} days)`)

          if (!dryRun) {
            await trigger.retireTrigger(
              triggerName,
              `No subscribers for ${inactiveDays} days`,
            )
          }

          result.triggersRetired.push(triggerName)
        }
      }

      // Check for stream deletion candidates
      if (
        metadata.status === 'retired'
        && metadata.retiredAt
      ) {
        const retiredTimestamp = new Date(metadata.retiredAt).getTime()

        if (retiredTimestamp < deleteThreshold) {
          const retiredDays = Math.floor((now - retiredTimestamp) / (24 * 60 * 60 * 1000))
          logger.info(
            `Would delete retired trigger stream: ${triggerName} `
            + `(retired for ${retiredDays} days)`,
          )

          // Note: Stream deletion not implemented as most adapters don't support it
          // Consider archiving or just keeping with status=retired
          // If your adapter supports stream deletion, implement here:
          // if (!dryRun) {
          //   const streamName = SubjectPatterns.trigger(triggerName)
          //   await store.deleteStream?.(streamName)
          //   result.streamsDeleted.push(triggerName)
          // }

          // For now, just track that we would delete
          result.streamsDeleted.push(triggerName)
        }
      }
    }
    catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      logger.error(`Error processing trigger ${triggerName}`, { error: errorMsg })
      result.errors.push({
        trigger: triggerName,
        error: errorMsg,
      })
    }
  }

  logger.info('Trigger cleanup complete', {
    triggersRetired: result.triggersRetired.length,
    streamsDeleted: result.streamsDeleted.length,
    errors: result.errors.length,
    dryRun,
  })

  return result
}

/**
 * Get cleanup statistics without performing cleanup
 */
export async function getTriggerCleanupStats(
  opts: Pick<TriggerCleanupOptions, 'retireAfterDays' | 'deleteStreamsAfterDays' | 'triggerPattern'> = {},
) {
  return cleanupTriggers({ ...opts, dryRun: true })
}

/**
 * Schedule automatic trigger cleanup (call this from a cron job or scheduled task)
 */
export async function scheduleCleanup(intervalHours: number = 24) {
  const logger = useNventLogger('trigger-cleanup')

  logger.info(`Scheduling trigger cleanup every ${intervalHours} hours`)

  const runCleanup = async () => {
    try {
      const result = await cleanupTriggers({
        retireAfterDays: 30,
        deleteStreamsAfterDays: 90,
        dryRun: false,
      })

      if (result.triggersRetired.length > 0 || result.errors.length > 0) {
        logger.info('Scheduled cleanup completed', {
          retired: result.triggersRetired.length,
          errors: result.errors.length,
        })
      }
    }
    catch (error) {
      logger.error('Scheduled cleanup failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // Run immediately on startup
  await runCleanup()

  // Then schedule recurring
  const intervalMs = intervalHours * 60 * 60 * 1000
  setInterval(runCleanup, intervalMs)
}
