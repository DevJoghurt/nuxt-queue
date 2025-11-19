/**
 * Type-safe hook definitions for await patterns
 * v0.5 - Await Integration
 */

import type { RunContext } from '../worker/node/runner'

export interface AwaitRegisterContext extends Pick<RunContext, 'flowId' | 'flowName' | 'stepName' | 'logger' | 'state'> {
  awaitType: 'webhook' | 'event' | 'schedule' | 'time'
  awaitConfig: any
}

export interface AwaitResolveContext extends Pick<RunContext, 'flowId' | 'flowName' | 'stepName' | 'logger' | 'state'> {
  awaitType: 'webhook' | 'event' | 'schedule' | 'time'
  resolvedData: any
}

/**
 * Define onAwaitRegister hook with proper types
 * Called when an await pattern is registered (before handler execution or after completion)
 *
 * @example
 * export const onAwaitRegister = defineAwaitRegisterHook(async (webhookUrl, stepData, ctx) => {
 *   // Send notification email with webhook URL
 *   await sendEmail({
 *     to: stepData.reviewerEmail,
 *     subject: 'Approval Required',
 *     approveUrl: webhookUrl
 *   })
 * })
 */
export function defineAwaitRegisterHook(
  hook: (
    webhookUrl: string,
    stepData: any,
    ctx: AwaitRegisterContext,
  ) => Promise<void>,
) {
  return hook
}

/**
 * Define onAwaitResolve hook with proper types
 * Called when an await pattern is resolved (external trigger fired)
 *
 * @example
 * export const onAwaitResolve = defineAwaitResolveHook(async (resolvedData, stepData, ctx) => {
 *   ctx.logger.log('info', 'Approval received', { approved: resolvedData.approved })
 *
 *   // Update external system
 *   await updateTicketStatus(stepData.ticketId, resolvedData.approved ? 'approved' : 'rejected')
 * })
 */
export function defineAwaitResolveHook(
  hook: (
    resolvedData: any,
    stepData: any,
    ctx: AwaitResolveContext,
  ) => Promise<void>,
) {
  return hook
}
