/**
 * Type-safe hook definitions for await patterns
 * v0.5 - Await Integration
 */

import type { RunContext } from '../../worker/node/runner'

export type AwaitType = 'webhook' | 'event' | 'schedule' | 'time'

/**
 * Hook data types specific to each await type
 */
export interface WebhookHookData {
  webhookUrl: string
}

export interface EventHookData {
  eventName: string
}

export interface ScheduleHookData {
  cronExpression: string
  nextOccurrence: Date
}

export interface TimeHookData {
  delayMs: number
}

/**
 * Conditional type to get the correct hook data based on await type
 */
export type HookDataForAwaitType<T extends AwaitType>
  = T extends 'webhook' ? WebhookHookData
    : T extends 'event' ? EventHookData
      : T extends 'schedule' ? ScheduleHookData
        : T extends 'time' ? TimeHookData
          : never

export interface AwaitRegisterContext<T extends AwaitType = AwaitType> extends Pick<RunContext, 'flowId' | 'flowName' | 'stepName' | 'logger' | 'state'> {
  awaitType: T
  awaitConfig: any
  position: 'before' | 'after'
}

export interface AwaitResolveContext<T extends AwaitType = AwaitType> extends Pick<RunContext, 'flowId' | 'flowName' | 'stepName' | 'logger' | 'state'> {
  awaitType: T
  resolvedData: any
  position: 'before' | 'after'
}

export interface AwaitTimeoutContext<T extends AwaitType = AwaitType> extends Pick<RunContext, 'flowId' | 'flowName' | 'stepName' | 'logger' | 'state'> {
  awaitType: T
  timeoutAction: 'fail' | 'continue' | 'retry'
  position: 'before' | 'after'
}

/**
 * Define onAwaitRegister hook with proper types
 * Called when an await pattern is registered (before handler execution or after completion)
 *
 * @example
 * // Webhook example
 * export const onAwaitRegister = defineAwaitRegisterHook(async (hookData, stepData, ctx) => {
 *   // hookData.webhookUrl is typed correctly for webhook awaits
 *   await sendEmail({
 *     to: stepData.reviewerEmail,
 *     subject: 'Approval Required',
 *     approveUrl: hookData.webhookUrl
 *   })
 * })
 *
 * // Event example
 * export const onAwaitRegister = defineAwaitRegisterHook(async (hookData, stepData, ctx) => {
 *   // hookData.eventName is available for event awaits
 *   console.log(`Waiting for event: ${hookData.eventName}`)
 * })
 */
export function defineAwaitRegisterHook<T extends AwaitType = AwaitType>(
  hook: (
    hookData: HookDataForAwaitType<T>,
    stepData: any,
    ctx: AwaitRegisterContext<T>,
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
export function defineAwaitResolveHook<T extends AwaitType = AwaitType>(
  hook: (
    resolvedData: any,
    stepData: any,
    ctx: AwaitResolveContext<T>,
  ) => Promise<void>,
) {
  return hook
}

/**
 * Define onAwaitTimeout hook with proper types
 * Called when an await pattern times out (timeout exceeded without resolution)
 *
 * @example
 * export const onAwaitTimeout = defineAwaitTimeoutHook(async (stepData, ctx) => {
 *   ctx.logger.log('warn', 'Approval request timed out', {
 *     action: ctx.timeoutAction
 *   })
 *
 *   // Send timeout notification
 *   await sendEmail({
 *     to: stepData.reviewerEmail,
 *     subject: 'Approval Request Expired',
 *     message: 'The approval request was not completed in time'
 *   })
 * })
 */
export function defineAwaitTimeoutHook<T extends AwaitType = AwaitType>(
  hook: (
    stepData: any,
    ctx: AwaitTimeoutContext<T>,
  ) => Promise<void>,
) {
  return hook
}
