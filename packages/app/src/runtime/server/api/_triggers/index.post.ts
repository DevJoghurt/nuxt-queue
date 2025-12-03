import { defineEventHandler, readBody, useTrigger } from '#imports'

/**
 * POST /api/_triggers
 *
 * Register a new trigger with subscriptions
 */
export default defineEventHandler(async (event) => {
  const logger = {
    info: console.log,
    error: console.error,
  }
  const trigger = useTrigger()

  try {
    const body = await readBody(event)

    // Validate required fields
    if (!body.name) {
      return {
        error: 'Missing required field: name',
        statusCode: 400,
      }
    }

    if (!body.type) {
      return {
        error: 'Missing required field: type',
        statusCode: 400,
      }
    }

    if (!['event', 'webhook', 'schedule', 'manual'].includes(body.type)) {
      return {
        error: 'Invalid trigger type',
        statusCode: 400,
      }
    }

    // Validate type-specific configuration
    if (body.type === 'event' && !body.config?.event) {
      return {
        error: 'Event triggers require config.event',
        statusCode: 400,
      }
    }

    if (body.type === 'webhook' && !body.config?.path) {
      return {
        error: 'Webhook triggers require config.path',
        statusCode: 400,
      }
    }

    if (body.type === 'schedule') {
      if (!body.config?.cron && !body.config?.interval) {
        return {
          error: 'Schedule triggers require config.cron or config.interval',
          statusCode: 400,
        }
      }
    }

    logger.info('Registering new trigger', {
      name: body.name,
      type: body.type,
      subscriptions: body.subscriptions?.length || 0,
    })

    // Check if trigger already exists
    if (trigger.hasTrigger(body.name)) {
      return {
        error: 'Trigger already exists',
        statusCode: 409,
      }
    }

    // Prepare trigger options based on type
    const triggerOpts: any = {
      name: body.name,
      type: body.type,
      scope: body.scope || 'flow',
      displayName: body.displayName || body.name,
      description: body.description,
      source: 'ui',
    }

    // Add type-specific configuration
    if (body.type === 'webhook') {
      triggerOpts.webhook = {
        path: body.config.path,
        method: body.config.method || 'POST',
        auth: body.config.requireAuth
          ? {
              header: body.config.authHeader || 'X-API-Key',
            }
          : undefined,
      }
    }
    else if (body.type === 'schedule') {
      triggerOpts.schedule = {
        cron: body.config.cron || undefined,
        interval: body.config.interval || undefined,
        timezone: body.config.timezone || 'UTC',
      }
      if (body.config.runImmediately) {
        triggerOpts.config = { runImmediately: true }
      }
    }
    else if (body.type === 'event') {
      triggerOpts.config = {
        event: body.config.event,
        filter: body.config.filter ? JSON.parse(body.config.filter) : undefined,
      }
    }

    // Register the trigger
    await trigger.registerTrigger(triggerOpts)

    // Subscribe flows to the trigger
    if (body.subscriptions && body.subscriptions.length > 0) {
      for (const flowName of body.subscriptions) {
        await trigger.subscribeTrigger({
          trigger: body.name,
          flow: flowName,
          mode: 'auto',
        })
      }
    }

    logger.info(
      `Successfully registered trigger '${body.name}' with ${body.subscriptions?.length || 0} subscriptions`,
    )

    // Return success with trigger details
    return {
      success: true,
      trigger: {
        name: body.name,
        displayName: body.displayName || body.name,
        type: body.type,
        scope: body.scope || 'flow',
        config: body.config || {},
        subscriptions: body.subscriptions || [],
        status: 'active',
        createdAt: new Date().toISOString(),
      },
    }
  }
  catch (err) {
    logger.error('Failed to create trigger', { error: err })
    return {
      error: 'Failed to create trigger',
      message: err instanceof Error ? err.message : String(err),
      statusCode: 500,
    }
  }
})
