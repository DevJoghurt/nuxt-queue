import { defineEventHandler, getRouterParam, readBody, useTrigger } from '#imports'

/**
 * PATCH /api/_triggers/:name
 *
 * Update an existing trigger
 */
export default defineEventHandler(async (event) => {
  const logger = {
    info: console.log,
    error: console.error,
  }
  const trigger = useTrigger()
  const name = getRouterParam(event, 'name')

  if (!name) {
    return {
      error: 'Missing trigger name',
      statusCode: 400,
    }
  }

  try {
    const body = await readBody(event)

    logger.info('Updating trigger', {
      name,
      updates: Object.keys(body),
    })

    // Check if trigger exists
    if (!trigger.hasTrigger(name)) {
      return {
        error: 'Trigger not found',
        statusCode: 404,
      }
    }

    // Get existing trigger
    const existing = trigger.getTrigger(name)
    if (!existing) {
      return {
        error: 'Trigger not found',
        statusCode: 404,
      }
    }

    // Prepare update options
    const updateOpts: any = {
      name,
      type: existing.type,
      scope: existing.scope,
      displayName: body.displayName !== undefined ? body.displayName : existing.displayName,
      description: body.description !== undefined ? body.description : existing.description,
      source: existing.source,
    }

    // Handle type-specific config updates
    if (existing.type === 'webhook' && body.config) {
      updateOpts.webhook = {
        path: body.config.path !== undefined ? body.config.path : existing.webhook?.path,
        method: body.config.method !== undefined ? body.config.method : existing.webhook?.method,
        auth: body.config.requireAuth
          ? {
              header: body.config.authHeader || existing.webhook?.auth?.header || 'X-API-Key',
            }
          : undefined,
      }
    }
    else if (existing.webhook) {
      updateOpts.webhook = existing.webhook
    }

    if (existing.type === 'schedule' && body.config) {
      updateOpts.schedule = {
        cron: body.config.cron !== undefined ? body.config.cron : existing.schedule?.cron,
        timezone: body.config.timezone !== undefined ? body.config.timezone : existing.schedule?.timezone,
        enabled: body.config.enabled !== undefined ? body.config.enabled : existing.schedule?.enabled,
      }
      // Only add interval if it exists (it's not in the type definition but may be supported)
      if (body.config.interval !== undefined || (existing.schedule as any)?.interval !== undefined) {
        (updateOpts.schedule as any).interval = body.config.interval !== undefined ? body.config.interval : (existing.schedule as any)?.interval
      }
    }
    else if (existing.schedule) {
      updateOpts.schedule = existing.schedule
    }

    if (existing.type === 'event' && body.config) {
      updateOpts.config = {
        event: body.config.event !== undefined ? body.config.event : existing.config?.event,
        filter: body.config.filter !== undefined
          ? (body.config.filter ? JSON.parse(body.config.filter) : undefined)
          : existing.config?.filter,
      }
    }
    else if (existing.config) {
      updateOpts.config = existing.config
    }

    // Update the trigger (this will trigger trigger.updated event)
    await trigger.registerTrigger(updateOpts)

    // Handle subscription changes
    if (body.subscriptions !== undefined) {
      const currentSubs = existing.subscriptions ? Object.keys(existing.subscriptions) : []
      const newSubs = body.subscriptions as string[]

      // Remove subscriptions that are no longer in the list
      for (const flowName of currentSubs) {
        if (!newSubs.includes(flowName)) {
          await trigger.unsubscribeTrigger(name, flowName)
        }
      }

      // Add new subscriptions
      for (const flowName of newSubs) {
        if (!currentSubs.includes(flowName)) {
          await trigger.subscribeTrigger({
            trigger: name,
            flow: flowName,
            mode: 'auto',
          })
        }
      }
    }

    logger.info(`Successfully updated trigger '${name}'`)

    // Return updated trigger
    const updated = trigger.getTrigger(name)
    return {
      success: true,
      trigger: updated,
    }
  }
  catch (err) {
    logger.error('Failed to update trigger', { error: err })
    return {
      error: 'Failed to update trigger',
      message: err instanceof Error ? err.message : String(err),
      statusCode: 500,
    }
  }
})
