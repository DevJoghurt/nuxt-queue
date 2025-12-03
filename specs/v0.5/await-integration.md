# Await Pattern Integration with Flow System

> **Version**: v0.5.1  
> **Status**: 📋 Specification  
> **Last Updated**: 2025-11-19  
> **Related**: [trigger-system.md](./trigger-system.md)

## Overview

This document specifies how await patterns (`awaitBefore` / `awaitAfter`) integrate with the flow execution system. It covers all integration points: worker context, runner logic, flow wiring, lifecycle hooks, and flow analysis.

## Problem Statement

The await pattern implementations exist (webhook, event, schedule, time), but they're not integrated with the flow execution lifecycle. Steps can't actually pause/resume based on `awaitBefore`/`awaitAfter` configurations.

**Missing Integration Points:**
1. ❌ Worker context doesn't expose await/trigger data
2. ❌ Worker runner doesn't check for await configs before/after execution
3. ❌ Flow wiring doesn't coordinate with await lifecycle
4. ❌ No lifecycle hook system for custom behavior
5. ❌ Step triggering doesn't check if step is awaiting
6. ❌ Emit blocking for `awaitAfter` not implemented
7. ❌ Flow analyzer doesn't extract await configs for UI/visualization

## Integration Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Flow Analyzer (Build Time)                                  │
│  • Extract awaitBefore/awaitAfter from configs              │
│  • Include in analyzed flow metadata                         │
│  • Used by UI for visualization                              │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│  Worker Context (Runtime - ctx parameter)                    │
│                                                               │
│  ctx.trigger        - Resolved await data (awaitBefore)      │
│  ctx.awaitConfig    - Current step's await configuration     │
│  ctx.awaitState     - Helper to check awaiting status        │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│  Worker Runner (Job Processor)                               │
│                                                              │
│  PRE-EXECUTION:                                              │
│  1. Load step config (awaitBefore/awaitAfter)                │
│  2. Check if job is awaiting resume (awaitResolved flag)     │
│                                                              │
│  AWAIT BEFORE:                                               │
│  3. If awaitBefore && !awaitResolved:                        │
│     a. Register await pattern                                │
│     b. Store await state                                     │
│     c. Call onAwaitRegister hook                            │
│     d. Return without executing handler                      │
│                                                               │
│  EXECUTE HANDLER:                                            │
│  4. Populate ctx.trigger with resolved data                 │
│  5. Execute user function                                    │
│  6. Capture result and emits                                 │
│                                                               │
│  AWAIT AFTER:                                                │
│  7. If awaitAfter:                                          │
│     a. Buffer emitted events                                 │
│     b. Register await pattern                                │
│     c. Store blocked emits                                   │
│     d. Call onAwaitRegister hook                            │
│     e. Mark step as awaiting-after                          │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│  Trigger Wiring (Event Handlers)                             │
│                                                               │
│  handleAwaitResolved:                                        │
│  • Call onAwaitResolve hook                                 │
│  • If awaitBefore: Re-queue job with awaitResolved flag    │
│  • If awaitAfter: Release blocked emits to event stream     │
│  • Delete await state                                        │
└────────────────────────┬─────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────────┐
│  Flow Wiring (Step Orchestration)                            │
│                                                               │
│  checkAndTriggerPendingSteps:                                │
│  • Before triggering step, check await state                │
│  • Skip steps with active await patterns                    │
│  • Prevent duplicate job enqueueing                          │
└──────────────────────────────────────────────────────────────┘
```

## 1. Flow Analyzer Integration

### 1.1. Extract Await Configurations

**File**: `packages/nvent/src/registry/flowAnalyzer.ts`

The flow analyzer must extract `awaitBefore` and `awaitAfter` configurations from step configs during build-time analysis. This data is used by:
- Flow UI for visualizing wait states
- Runtime for loading step configurations
- Documentation generation

**Required Changes:**

```typescript
interface AnalyzedStep {
  // ... existing fields
  awaitBefore?: AwaitConfig
  awaitAfter?: AwaitConfig
  hasAwaitPattern?: boolean  // Quick flag for runtime checks
}

interface AnalyzedFlow {
  // ... existing fields
  awaitPatterns?: {
    steps: string[]  // List of steps with await patterns
    beforeCount: number
    afterCount: number
    totalTimeout: number  // Sum of all await timeouts
  }
}
```

**Extraction Logic:**

```typescript
// In analyzeFlowStep function:
if (config.flow?.awaitBefore) {
  analyzedStep.awaitBefore = config.flow.awaitBefore
  analyzedStep.hasAwaitPattern = true
}

if (config.flow?.awaitAfter) {
  analyzedStep.awaitAfter = config.flow.awaitAfter
  analyzedStep.hasAwaitPattern = true
}
```

**Flow-Level Summary:**

```typescript
// After analyzing all steps:
const awaitSteps = steps.filter(s => s.hasAwaitPattern)
const totalTimeout = awaitSteps.reduce((sum, s) => {
  let stepTimeout = 0
  if (s.awaitBefore?.timeout) stepTimeout += s.awaitBefore.timeout
  if (s.awaitAfter?.timeout) stepTimeout += s.awaitAfter.timeout
  return sum + stepTimeout
}, 0)

analyzedFlow.awaitPatterns = {
  steps: awaitSteps.map(s => s.name),
  beforeCount: awaitSteps.filter(s => s.awaitBefore).length,
  afterCount: awaitSteps.filter(s => s.awaitAfter).length,
  totalTimeout
}
```

### 1.2. Calculate Flow-Level Stall Timeout

When a flow contains await patterns, the stall timeout must account for the maximum expected wait time to avoid false positives.

**Calculation Logic:**

```typescript
// In analyzeFlow function:
function calculateFlowStallTimeout(steps: Record<string, AnalyzedStep>): number {
  let maxAwaitTimeout = 0
  
  // Find longest await timeout in the flow
  for (const step of Object.values(steps)) {
    if (step.awaitBefore?.timeout) {
      maxAwaitTimeout = Math.max(maxAwaitTimeout, step.awaitBefore.timeout)
    }
    if (step.awaitAfter?.timeout) {
      maxAwaitTimeout = Math.max(maxAwaitTimeout, step.awaitAfter.timeout)
    }
  }
  
  // If flow has awaits, add buffer to longest timeout
  // Otherwise use default (30 minutes)
  if (maxAwaitTimeout > 0) {
    // Add 10% buffer + minimum 5 minutes for processing time
    const buffer = Math.max(maxAwaitTimeout * 0.1, 5 * 60 * 1000)
    return maxAwaitTimeout + buffer
  }
  
  return 30 * 60 * 1000 // Default 30 minutes
}

// Add to AnalyzedFlow
analyzedFlow.stallTimeout = calculateFlowStallTimeout(analyzedFlow.steps)
```

**Example:**

```typescript
// Flow with multiple awaits (additive)
// Step 1:
awaitBefore: {
  type: 'webhook',
  timeout: 3600000  // 1 hour
}

// Step 2:
awaitAfter: {
  type: 'time',
  delay: 7200000,  // 2 hours
  timeout: 7200000
}

// Step 3:
awaitBefore: {
  type: 'event',
  timeout: 1800000  // 30 minutes
}

// Calculated stall timeout (ADDITIVE):
// Total await time: 1h + 2h + 30m = 12600000ms (3.5 hours)
// With 10% buffer: 12600000 + 1260000 = 13860000ms (3.85 hours)
```

### 1.3. Template Generation

The await configs and calculated stall timeout must be included in the generated registry template:

```typescript
// In generateQueueRegistryTemplate:
const stepMeta = {
  queue: step.queue,
  awaitBefore: step.awaitBefore || undefined,
  awaitAfter: step.awaitAfter || undefined,
  hasAwaitPattern: step.hasAwaitPattern || false
}

// In generateFlowMetadata:
const flowMeta = {
  id: flow.id,
  entry: flow.entry,
  steps: flow.steps,
  stallTimeout: flow.stallTimeout  // NEW: Per-flow stall timeout
}
```

## 2. Worker Context Extension

### 2.1. RunContext Interface

**File**: `packages/nvent/src/runtime/worker/node/runner.ts`

Extend the `RunContext` interface to expose await-related data:

```typescript
export interface RunContext {
  // ... existing fields (jobId, queue, flowId, etc.)
  
  /**
   * Resolved data from await pattern (awaitBefore only)
   * Available when step resumes after await resolution
   * 
   * @example
   * // After webhook fires:
   * const { approved, comments } = ctx.trigger
   */
  trigger?: any
  
  /**
   * Current step's await configuration
   * Useful for conditional logic based on await settings
   * 
   * @example
   * if (ctx.awaitConfig?.type === 'webhook') {
   *   // Handle webhook-specific logic
   * }
   */
  awaitConfig?: AwaitConfig
  
  /**
   * Helper to check if step is currently in awaiting state
   * Queries store for await state
   * 
   * @example
   * const isWaiting = await ctx.awaitState()
   * if (isWaiting) {
   *   ctx.logger.log('info', 'Step is awaiting external trigger')
   * }
   */
  awaitState: () => Promise<boolean>
}
```

### 2.2. Context Builder

Update `buildContext` to populate await-related fields:

```typescript
export function buildContext(partial?: Partial<RunContext>): RunContext {
  // ... existing context building
  
  // Await state helper - queries flow run index metadata
  const awaitState = async (): Promise<boolean> => {
    if (!partial?.flowId || !partial?.flowName || !partial?.stepName) return false
    
    try {
      const store = useStoreAdapter()
      const { SubjectPatterns } = useStreamTopics()
      const indexKey = SubjectPatterns.flowRunIndex(partial.flowName)
      
      if (!store.indexGet) return false
      
      const flowEntry = await store.indexGet(indexKey, partial.flowId)
      return !!flowEntry?.metadata?.awaitingSteps?.[partial.stepName]
    } catch {
      return false
    }
  }
  
  return {
    // ... existing fields
    trigger: partial?.trigger,
    awaitConfig: partial?.awaitConfig,
    awaitState
  }
}
```

## 3. Worker Runner Integration

### 3.1. Pre-Execution: Load Step Configuration

**File**: `packages/nvent/src/runtime/worker/node/runner.ts`

Before executing the handler, load the step's await configuration from the registry:

```typescript
export function createJobProcessor(handler: NodeHandler, queueName: string) {
  return async function processor(job: QueueJob) {
    // ... existing job processing setup
    
    // Load step configuration from registry
    const registry = $useQueueRegistry() as any
    const flowRegistry = (registry?.flows || {})[flowName]
    const stepMeta = flowRegistry?.steps?.[job.name]
    const awaitBefore = stepMeta?.awaitBefore
    const awaitAfter = stepMeta?.awaitAfter
    
    // Check if this is an await resume
    const isAwaitResume = job.data?.awaitResolved === true
    const awaitData = job.data?.awaitData
```

### 3.2. Await Before: Register Pattern and Pause

If the step has `awaitBefore` config and this is NOT a resume, register the await pattern and return early:

```typescript
    // AWAIT BEFORE: Don't execute handler, register pattern instead
    if (awaitBefore && !isAwaitResume) {
      const logger = useNventLogger('await-before')
      
      logger.info('Step has awaitBefore, registering await pattern', {
        flowName,
        runId: flowId,
        stepName: job.name,
        awaitType: awaitBefore.type
      })
      
      // Register await pattern
      const { registerAwaitPattern } = await import('../../utils/awaitPatterns')
      const awaitResult = await registerAwaitPattern({
        runId: flowId!,
        stepName: job.name,
        awaitType: awaitBefore.type,
        config: awaitBefore
      })
      
      // Store await state in flow run index metadata
      const store = useStoreAdapter()
      const { SubjectPatterns } = useStreamTopics()
      const indexKey = SubjectPatterns.flowRunIndex(flowName)
      
      if (store.indexUpdateWithRetry) {
        await store.indexUpdateWithRetry(indexKey, flowId!, {
          [`awaitingSteps.${job.name}`]: {
            awaitType: awaitBefore.type,
            registeredAt: Date.now(),
            position: 'before',
            webhookUrl: awaitResult.webhookUrl,
            timeoutAt: awaitBefore.timeout ? Date.now() + awaitBefore.timeout : undefined
          }
        })
      }
      
      // Call lifecycle hook if exists
      const hooks = await loadLifecycleHooks(flowName, job.name)
      if (hooks?.onAwaitRegister) {
        await hooks.onAwaitRegister(
          awaitResult.webhookUrl || awaitResult.eventName || '',
          job.data,
          buildContext({ flowId, flowName, stepName: job.name })
        )
      }
      
      // Publish await.registered event
      const eventMgr = useEventManager()
      eventMgr.publishBus({
        type: 'await.registered',
        flowName,
        runId: flowId!,
        stepName: job.name,
        data: {
          awaitType: awaitBefore.type,
          awaitConfig: awaitBefore,
          webhookUrl: awaitResult.webhookUrl
        }
      })
      
      // Return early - handler will execute after await resolves
      return {
        awaiting: true,
        awaitType: awaitBefore.type,
        awaitConfig: awaitBefore
      }
    }
```

### 3.3. Execute Handler with Await Context

Build context with trigger data if this is a resume:

```typescript
    // Build context with await data if resuming
    const ctx = buildContext({
      jobId: job.id as string,
      queue: queueName,
      flowId,
      flowName,
      stepName: job.name,
      stepId: stepRunId,
      attempt,
      trigger: isAwaitResume ? awaitData : undefined,
      awaitConfig: awaitBefore || awaitAfter || undefined
    })
    
    // Execute handler
    const result = await handler(job.data, ctx)
```

### 3.4. Await After: Buffer Emits and Register Pattern

After handler completes, check for `awaitAfter` and buffer emits:

```typescript
    // AWAIT AFTER: Buffer emits and register await pattern
    if (awaitAfter && !isAwaitResume) {
      const logger = useNventLogger('await-after')
      
      logger.info('Step has awaitAfter, registering await pattern', {
        flowName,
        runId: flowId,
        stepName: job.name,
        awaitType: awaitAfter.type
      })
      
      // Capture any emitted events from this step
      // (They're already published but we need to block propagation)
      const streamName = SubjectPatterns.flowRun(flowId!)
      const recentEvents = await store.read(streamName)
      const emitEvents = recentEvents.filter(evt => 
        evt.type === 'emit' && 
        evt.stepName === job.name &&
        evt.id > lastEventId // Events from this execution
      )
      
      // Store blocked emits
      if (store.kv?.set && emitEvents.length > 0) {
        await store.kv.set(
          `await:blocked-emits:${flowId}:${job.name}`,
          emitEvents,
          awaitAfter.timeout
        )
      }
      
      // Register await pattern
      const { registerAwaitPattern } = await import('../../utils/awaitPatterns')
      const awaitResult = await registerAwaitPattern({
        runId: flowId!,
        stepName: job.name,
        awaitType: awaitAfter.type,
        config: awaitAfter
      })
      
      // Store await state in flow run index metadata
      const indexKey = SubjectPatterns.flowRunIndex(flowName)
      
      if (store.indexUpdateWithRetry) {
        await store.indexUpdateWithRetry(indexKey, flowId!, {
          [`awaitingSteps.${job.name}`]: {
            awaitType: awaitAfter.type,
            registeredAt: Date.now(),
            position: 'after',
            webhookUrl: awaitResult.webhookUrl,
            timeoutAt: awaitAfter.timeout ? Date.now() + awaitAfter.timeout : undefined,
            hasBlockedEmits: emitEvents.length > 0
          }
        })
      }
      
      // Call lifecycle hook
      const hooks = await loadLifecycleHooks(flowName, job.name)
      if (hooks?.onAwaitRegister) {
        await hooks.onAwaitRegister(
          awaitResult.webhookUrl || awaitResult.eventName || '',
          { ...job.data, result },
          ctx
        )
      }
      
      // Publish await.registered event
      eventMgr.publishBus({
        type: 'await.registered',
        flowName,
        runId: flowId!,
        stepName: job.name,
        data: {
          awaitType: awaitAfter.type,
          awaitConfig: awaitAfter,
          position: 'after',
          webhookUrl: awaitResult.webhookUrl
        }
      })
    }
    
    return result
  }
}
```

## 4. Lifecycle Hooks System

### 4.1. Hook Registry

**File**: `packages/nvent/src/registry/hookRegistry.ts` (new)

Create a registry for lifecycle hooks extracted from worker files:

```typescript
export interface LifecycleHooks {
  /**
   * Called when await pattern is registered
   * @param webhookUrl - Generated webhook URL (for webhook awaits)
   * @param stepData - Current step data
   * @param ctx - Worker context
   */
  onAwaitRegister?: (
    webhookUrl: string,
    stepData: any,
    ctx: any
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
    ctx: any
  ) => Promise<void>
}

const hookRegistry = new Map<string, LifecycleHooks>()

export function registerHooks(
  flowName: string,
  stepName: string,
  hooks: LifecycleHooks
) {
  const key = `${flowName}:${stepName}`
  hookRegistry.set(key, hooks)
}

export async function loadLifecycleHooks(
  flowName: string,
  stepName: string
): Promise<LifecycleHooks | null> {
  const key = `${flowName}:${stepName}`
  return hookRegistry.get(key) || null
}
```

### 4.2. Hook Extraction in Worker Loader

**File**: `packages/nvent/src/runtime/worker/loaders/nodeLoader.ts`

When loading worker modules, extract lifecycle hooks:

```typescript
export async function loadWorkerModule(workerPath: string) {
  const mod = await import(workerPath)
  
  // Extract hooks if present
  const hooks: LifecycleHooks = {}
  if (typeof mod.onAwaitRegister === 'function') {
    hooks.onAwaitRegister = mod.onAwaitRegister
  }
  if (typeof mod.onAwaitResolve === 'function') {
    hooks.onAwaitResolve = mod.onAwaitResolve
  }
  
  // Register hooks
  if (Object.keys(hooks).length > 0) {
    const config = mod.config
    if (config?.flow?.name && config?.flow?.step) {
      const flowNames = Array.isArray(config.flow.name) 
        ? config.flow.name 
        : [config.flow.name]
      
      for (const flowName of flowNames) {
        registerHooks(flowName, config.flow.step, hooks)
      }
    }
  }
  
  return mod.default
}
```

## 5. Trigger Wiring Updates

### 5.1. Handle Await Resolution

**File**: `packages/nvent/src/runtime/events/wiring/triggerWiring.ts`

Update `handleAwaitResolved` to handle both `awaitBefore` and `awaitAfter`:

```typescript
async function handleAwaitResolved(event: AwaitResolvedEvent) {
  const logger = useNventLogger('await-wiring')
  const store = useStoreAdapter()
  const { runId, stepName, triggerData: resolvedData } = event
  
  // Get await state from flow run index metadata
  const { SubjectPatterns } = useStreamTopics()
  const indexKey = SubjectPatterns.flowRunIndex(flowName)
  
  let awaitState: any = null
  if (store.indexGet) {
    const flowEntry = await store.indexGet(indexKey, runId)
    awaitState = flowEntry?.metadata?.awaitingSteps?.[stepName]
  }
  
  // Call lifecycle hook
  const flowName = event.flowName
  const hooks = await loadLifecycleHooks(flowName, stepName)
  if (hooks?.onAwaitResolve) {
    await hooks.onAwaitResolve(
      resolvedData,
      { runId, stepName },
      buildContext({ flowId: runId, flowName, stepName })
    )
  }
  
  if (awaitState?.position === 'before') {
    // AWAIT BEFORE: Re-queue step to execute handler
    logger.info('Await before resolved, re-queuing step', { runId, stepName })
    await resumeStepAfterAwait(runId, stepName, resolvedData)
  } 
  else if (awaitState?.position === 'after') {
    // AWAIT AFTER: Release blocked emits
    logger.info('Await after resolved, releasing blocked emits', { runId, stepName })
    
    if (store.kv?.get) {
      const blockedEmits = await store.kv.get(
        `await:blocked-emits:${runId}:${stepName}`
      )
      
      if (blockedEmits && Array.isArray(blockedEmits)) {
        // Replay emits to trigger dependent steps
        const eventBus = getEventBus()
        for (const emitEvent of blockedEmits) {
          logger.debug('Replaying blocked emit', {
            runId,
            stepName,
            emitName: emitEvent.data?.name
          })
          await eventBus.publish(emitEvent)
        }
        
        // Delete blocked emits
        await store.kv.delete(`await:blocked-emits:${runId}:${stepName}`)
        
        // Trigger pending steps (now that emits are available)
        await checkAndTriggerPendingSteps(flowName, runId, store)
      }
    }
  }
  
  // Clean up await state from flow run index metadata
  if (store.indexGet && store.indexUpdateWithRetry) {
    const flowEntry = await store.indexGet(indexKey, runId)
    if (flowEntry?.metadata?.awaitingSteps) {
      const awaitingSteps = { ...flowEntry.metadata.awaitingSteps }
      delete awaitingSteps[stepName]
      await store.indexUpdateWithRetry(indexKey, runId, { awaitingSteps })
    }
  }
  
  logger.debug('Await pattern resolved', {
    runId,
    stepName,
    position: awaitState?.position
  })
}
```

## 6. Flow Wiring Updates

### 6.1. Check Await State Before Triggering

**File**: `packages/nvent/src/runtime/events/wiring/flowWiring.ts`

Update `checkAndTriggerPendingSteps` to skip steps that are awaiting:

```typescript
async function checkAndTriggerPendingSteps(
  flowName: string,
  runId: string,
  store: ReturnType<typeof useStoreAdapter>,
): Promise<void> {
  // ... existing setup code
  
  // Check all steps in the flow to see if any can now be triggered
  for (const [stepName, stepDef] of Object.entries(flowDef.steps)) {
    const step = stepDef as any
    
    // Skip if step doesn't have dependencies or already completed
    if (!step.subscribes || completedSteps.has(stepName)) continue
    
    // CHECK AWAIT STATE: Skip if step is currently awaiting
    let isAwaiting = false
    if (store.indexGet) {
      const flowEntry = await store.indexGet(indexKey, runId)
      const awaitState = flowEntry?.metadata?.awaitingSteps?.[stepName]
      if (awaitState) {
        logger.debug('Step is awaiting, skipping trigger', {
          flowName,
          runId,
          stepName,
          awaitState
        })
        isAwaiting = true
      }
    }
    
    if (isAwaiting) continue
    
    // Check if all dependencies are now satisfied
    const canTrigger = checkPendingStepTriggers(step, emittedEvents, completedSteps)
    
    // ... rest of triggering logic
  }
}
```

### 6.2. Block Emit Propagation for awaitAfter

When a step has `awaitAfter`, its emit events should be stored but NOT propagate to trigger dependent steps until resolved.

This is handled by:
1. Worker runner stores emits in KV with `await:blocked-emits` key
2. Flow wiring doesn't see these emits in the normal event stream
3. After resolution, `handleAwaitResolved` replays emits to event stream
4. `checkAndTriggerPendingSteps` then sees the emits and triggers dependent steps

**No additional changes needed** - the KV storage acts as a buffer.

## 7. Storage Schema

### 7.1. Flow Run Index Metadata (Preferred)

Use the existing flow run index metadata instead of separate KV storage. This centralizes all flow state and leverages atomic operations.

**Current Structure Extended:**

```typescript
// Key: nq:flows:{flowName}
// Entry ID: {runId}
// Metadata:
{
  // Existing fields
  status: 'running' | 'completed' | 'failed' | 'canceled',
  startedAt: number,
  lastActivityAt: number,
  stepCount: number,
  completedSteps: number,
  emittedEvents: string[],
  
  // NEW: Await state tracking
  awaitingSteps?: {
    [stepName: string]: {
      awaitType: 'webhook' | 'event' | 'schedule' | 'time',
      registeredAt: number,
      position: 'before' | 'after',
      webhookUrl?: string,
      timeoutAt?: number,
      hasBlockedEmits?: boolean
    }
  }
}
```

**Benefits:**
- ✅ Atomic updates with `indexUpdateWithRetry`
- ✅ Already queried for flow listings/UI
- ✅ Centralized flow state
- ✅ Version control prevents race conditions
- ✅ No additional KV keys needed

**Operations:**

```typescript
// Add awaiting step
await store.indexUpdateWithRetry(indexKey, runId, {
  [`awaitingSteps.${stepName}`]: {
    awaitType: 'webhook',
    registeredAt: Date.now(),
    position: 'before',
    webhookUrl: 'https://...'
  }
})

// Check if step is awaiting
const flowEntry = await store.indexGet(indexKey, runId)
const isAwaiting = flowEntry?.metadata?.awaitingSteps?.[stepName]

// Remove awaiting step (on resolution)
const flowEntry = await store.indexGet(indexKey, runId)
const awaitingSteps = { ...flowEntry.metadata.awaitingSteps }
delete awaitingSteps[stepName]
await store.indexUpdateWithRetry(indexKey, runId, {
  awaitingSteps
})
```

### 7.2. KV Storage (Fallback for Ephemeral Data)

Use KV only for data that doesn't need to persist in flow metadata:

**Blocked Emits (awaitAfter):**
```typescript
// Key: await:blocked-emits:{runId}:{stepName}
// Value: EventRecord[]  // Array of emit events
// TTL: awaitConfig.timeout
```

**Webhook Routing:**
```typescript
// Key: await:webhook:{webhookId}
// Value:
{
  runId: string,
  stepName: string,
  awaitType: 'webhook',
  position: 'before' | 'after'
}
// TTL: awaitConfig.timeout
```

**Timeout Tracking:**
```typescript
// Key: await:timeout:{runId}:{stepName}
// Value:
{
  timeoutAt: number,
  action: 'fail' | 'continue' | 'retry'
}
// TTL: awaitConfig.timeout (in seconds)
```

### 7.3. Hybrid Approach Rationale

| Data Type | Storage | Reason |
|-----------|---------|--------|
| Await state (which steps awaiting) | **Index Metadata** | Queried by UI, needs atomic updates, part of flow state |
| Blocked emits | **KV** | Temporary buffer, not needed after resolution |
| Webhook routing | **KV** | Lookup table for incoming webhooks, ephemeral |
| Timeout tracking | **KV** | Scheduler uses TTL for expiration, ephemeral |

This hybrid approach minimizes storage overhead while keeping flow state centralized.

## 8. Stall Detection Integration

### 8.1. Problem Statement

The current stall detection marks flows as "stalled" if they have no activity for longer than a configured timeout (default 30 minutes). This creates false positives for flows with await patterns that legitimately pause for extended periods (e.g., 24-hour approval webhooks).

**Issue:**
```typescript
// Flow with 24-hour approval await
awaitBefore: { type: 'webhook', timeout: 86400000 }

// Current stall detector (30 min timeout):
// ❌ Flow marked as "stalled" after 30 minutes
// ✅ Should wait 24+ hours before marking as stalled
```

### 8.2. Solution: Await-Aware Stall Detection

**Approach:**
1. Calculate flow-level stall timeout during analysis (based on longest await timeout)
2. Store per-flow stall timeout in analyzed flow metadata
3. Use flow-specific stall timeout instead of global default
4. Exclude awaiting steps from activity tracking

### 8.3. Flow Analyzer Changes

**File**: `packages/nvent/src/registry/flowAnalyzer.ts`

Add stall timeout calculation to flow analysis:

```typescript
interface AnalyzedFlow {
  // ... existing fields
  stallTimeout: number  // NEW: Calculated based on await patterns
  awaitPatterns?: {
    steps: string[]
    beforeCount: number
    afterCount: number
    maxTimeout: number  // Longest await timeout in ms
  }
}

function calculateFlowStallTimeout(steps: Record<string, AnalyzedStep>): number {
  const DEFAULT_STALL_TIMEOUT = 30 * 60 * 1000 // 30 minutes
  const MIN_BUFFER = 5 * 60 * 1000 // 5 minutes
  const BUFFER_PERCENTAGE = 0.1 // 10%
  
  let totalAwaitTimeout = 0
  let awaitCount = 0
  
  // Sum ALL await timeouts (additive)
  // A flow may wait multiple times during execution
  for (const step of Object.values(steps)) {
    if (step.awaitBefore?.timeout) {
      totalAwaitTimeout += step.awaitBefore.timeout
      awaitCount++
    }
    if (step.awaitAfter?.timeout) {
      totalAwaitTimeout += step.awaitAfter.timeout
      awaitCount++
    }
  }
  
  // No awaits? Use default
  if (totalAwaitTimeout === 0) {
    return DEFAULT_STALL_TIMEOUT
  }
  
  // Calculate timeout with buffer
  // Add 10% buffer or 5 minutes (whichever is larger) for processing time
  const buffer = Math.max(totalAwaitTimeout * BUFFER_PERCENTAGE, MIN_BUFFER)
  const calculatedTimeout = totalAwaitTimeout + buffer
  
  // Log if significantly different from default
  if (calculatedTimeout > DEFAULT_STALL_TIMEOUT * 2) {
    console.log(
      `[flow-analyzer] Flow has ${awaitCount} await patterns, ` +
      `calculated stall timeout: ${calculatedTimeout / 1000}s ` +
      `(total await time: ${totalAwaitTimeout / 1000}s)`
    )
  }
  
  return calculatedTimeout
}

// In analyzeFlow function:
export function analyzeFlow(flow: FlowMeta): AnalyzedFlow {
  // ... existing analysis
  
  // Calculate stall timeout based on await patterns
  const stallTimeout = calculateFlowStallTimeout(analyzedSteps)
  
  return {
    id: flow.id,
    entry: flow.entry,
    steps: analyzedSteps,
    levels: levelGroups,
    maxLevel,
    stallTimeout,  // NEW
    awaitPatterns: {
      steps: awaitSteps.map(s => s.name),
      beforeCount: awaitSteps.filter(s => s.awaitBefore).length,
      afterCount: awaitSteps.filter(s => s.awaitAfter).length,
      totalTimeout  // Store for reference (additive sum)
    }
  }
}
```

### 8.4. Stall Detector Changes

**File**: `packages/nvent/src/runtime/events/utils/stallDetector.ts`

Update stall detector to use per-flow timeout and check await state:

```typescript
export class FlowStallDetector {
  // ... existing code
  
  /**
   * Get stall timeout for a specific flow
   * Uses flow-specific timeout from analyzed metadata, falls back to global config
   */
  private async getFlowStallTimeout(flowName: string): Promise<number> {
    try {
      const { $useAnalyzedFlows } = await import('#imports')
      const analyzedFlows = $useAnalyzedFlows() as any[]
      const flowMeta = analyzedFlows.find((f: any) => f.id === flowName)
      
      if (flowMeta?.stallTimeout) {
        return flowMeta.stallTimeout
      }
    } catch (error) {
      this.logger.warn('Failed to get flow-specific stall timeout', {
        flowName,
        error: (error as Error).message
      })
    }
    
    // Fall back to global config
    return this.config.stallTimeout
  }
  
  /**
   * Check if a specific flow is stalled (await-aware)
   */
  async isStalled(flowName: string, runId: string): Promise<boolean> {
    const { SubjectPatterns } = useStreamTopics()
    const indexKey = SubjectPatterns.flowRunIndex(flowName)

    try {
      if (!this.store.indexGet) return false

      const flowEntry = await this.store.indexGet(indexKey, runId)
      if (!flowEntry?.metadata) return false

      // Only check running flows
      if (flowEntry.metadata.status !== 'running') return false
      
      // NEW: Check if flow has awaiting steps
      const awaitingSteps = flowEntry.metadata.awaitingSteps || {}
      const hasAwaitingSteps = Object.keys(awaitingSteps).length > 0
      
      if (hasAwaitingSteps) {
        // Flow is legitimately waiting, check against await-adjusted timeout
        const oldestAwait = Object.values(awaitingSteps).reduce((oldest: any, current: any) => {
          return !oldest || current.registeredAt < oldest.registeredAt ? current : oldest
        }, null)
        
        if (oldestAwait?.timeoutAt) {
          // Check if await has timed out (not stalled, just timed out)
          if (Date.now() > oldestAwait.timeoutAt) {
            this.logger.debug('Flow has timed out await pattern', {
              flowName,
              runId,
              awaitStep: Object.keys(awaitingSteps)[0],
              timeoutAt: oldestAwait.timeoutAt
            })
            // Await timeout is handled by triggerWiring, not stall detector
            return false
          }
          
          // Still within await timeout, not stalled
          this.logger.debug('Flow is awaiting, not stalled', {
            flowName,
            runId,
            awaitingSteps: Object.keys(awaitingSteps),
            remainingTime: oldestAwait.timeoutAt - Date.now()
          })
          return false
        }
      }

      // Get flow-specific stall timeout
      const stallTimeout = await this.getFlowStallTimeout(flowName)
      
      // Check activity timestamp
      const lastActivity = flowEntry.metadata.lastActivityAt || flowEntry.metadata.startedAt || 0
      const timeSinceActivity = Date.now() - lastActivity

      if (timeSinceActivity > stallTimeout) {
        this.logger.info('Flow detected as stalled (lazy check)', {
          flowName,
          runId,
          timeSinceActivity: `${Math.round(timeSinceActivity / 1000)}s`,
          stallTimeout: `${stallTimeout / 1000}s`,
          flowSpecificTimeout: stallTimeout !== this.config.stallTimeout
        })
        return true
      }

      return false
    }
    catch (error) {
      this.logger.warn('Failed to check if flow is stalled', {
        flowName,
        runId,
        error: (error as Error).message,
      })
      return false
    }
  }
  
  /**
   * Check all running flows and mark stalled ones (await-aware)
   */
  async checkFlowsForStalls(flowNames: string[]): Promise<void> {
    this.logger.debug('Running periodic stall check', { flows: flowNames.length })

    try {
      if (!this.store.indexGet || !this.store.indexRead) {
        this.logger.warn('Store does not support required index operations')
        return
      }

      const { SubjectPatterns } = useStreamTopics()
      let checkedCount = 0
      let stalledCount = 0
      let awaitingCount = 0

      // Check each flow
      for (const flowName of flowNames) {
        const indexKey = SubjectPatterns.flowRunIndex(flowName)
        const flowStallTimeout = await this.getFlowStallTimeout(flowName)

        // Get all flow runs from the index
        const entries = await this.store.indexRead(indexKey, { limit: 1000 })

        for (const entry of entries) {
          if (!entry.metadata) continue

          checkedCount++

          // Only check running flows
          if (entry.metadata.status !== 'running') continue
          
          // NEW: Skip flows with active awaits
          const awaitingSteps = entry.metadata.awaitingSteps || {}
          if (Object.keys(awaitingSteps).length > 0) {
            awaitingCount++
            continue // Legitimately waiting, not stalled
          }

          // Check if stalled
          const lastActivity = entry.metadata.lastActivityAt || entry.metadata.startedAt || 0
          const timeSinceActivity = Date.now() - lastActivity

          if (timeSinceActivity > flowStallTimeout) {
            await this.markAsStalled(
              flowName, 
              entry.id, 
              `No activity for ${Math.round(timeSinceActivity / 1000)}s (timeout: ${flowStallTimeout / 1000}s)`
            )
            stalledCount++
          }
        }
      }

      if (stalledCount > 0 || awaitingCount > 0) {
        this.logger.info('Periodic stall check completed', {
          checked: checkedCount,
          stalled: stalledCount,
          awaiting: awaitingCount
        })
      }
      else {
        this.logger.debug('Periodic stall check completed', {
          checked: checkedCount,
          stalled: 0,
          awaiting: 0
        })
      }
    }
    catch (error) {
      this.logger.error('Failed to run periodic stall check', {
        error: (error as Error).message,
      })
    }
  }
}
```

### 8.5. Activity Tracking for Await Events

Update activity timestamp when await patterns are registered/resolved:

**File**: `packages/nvent/src/runtime/events/wiring/triggerWiring.ts`

```typescript
async function handleAwaitRegistered(event: AwaitRegisteredEvent) {
  const { flowName, runId, stepName } = event
  
  // Update activity timestamp when await is registered
  if (stallDetector) {
    await stallDetector.updateActivity(flowName, runId)
  }
  
  // ... existing await registration logic
}

async function handleAwaitResolved(event: AwaitResolvedEvent) {
  const { flowName, runId, stepName } = event
  
  // Update activity timestamp when await is resolved
  if (stallDetector) {
    await stallDetector.updateActivity(flowName, runId)
  }
  
  // ... existing await resolution logic
}
```

### 8.6. Configuration

Update runtime configuration to support per-flow stall timeouts:

**File**: `packages/nvent/src/runtime/config/types.ts`

```typescript
export interface FlowConfig {
  stallDetection?: {
    /**
     * Enable stall detection
     * @default true
     */
    enabled?: boolean
    
    /**
     * Global default stall timeout in milliseconds
     * Overridden by per-flow calculated timeouts for flows with awaits
     * @default 1800000 (30 minutes)
     */
    stallTimeout?: number
    
    /**
     * Interval for periodic stall checks in milliseconds
     * @default 900000 (15 minutes)
     */
    checkInterval?: number
    
    /**
     * Enable periodic background checks
     * @default true
     */
    enablePeriodicCheck?: boolean
    
    /**
     * Force global timeout for all flows (ignore per-flow calculated timeouts)
     * Useful for testing or strict timeout requirements
     * @default false
     */
    forceGlobalTimeout?: boolean
  }
}
```

### 8.7. Example Scenarios

**Scenario 1: Flow with 24-hour approval**

```typescript
// Step config
awaitBefore: {
  type: 'webhook',
  timeout: 86400000  // 24 hours
}

// Analysis result
analyzedFlow.stallTimeout = 95040000  // 26.4 hours (24h + 10% buffer)

// Stall detection
// ✅ Waits 26.4 hours before marking as stalled
// ✅ Ignores flow during 24-hour await period
// ✅ No false positive "stalled" status
```

**Scenario 2: Flow with multiple awaits**

```typescript
// Step 1
awaitBefore: { type: 'webhook', timeout: 3600000 }  // 1 hour

// Step 2
awaitAfter: { type: 'time', delay: 7200000, timeout: 7200000 }  // 2 hours

// Step 3
awaitBefore: { type: 'event', timeout: 1800000 }  // 30 minutes

// Analysis result (ADDITIVE)
totalAwaitTime = 3600000 + 7200000 + 1800000 = 12600000  // 3.5 hours
analyzedFlow.stallTimeout = 13860000  // 3.85 hours (3.5h + 10% buffer)

// Stall detection uses sum of all await timeouts
```

**Scenario 3: Flow without awaits**

```typescript
// No await patterns in flow

// Analysis result
analyzedFlow.stallTimeout = 1800000  // 30 minutes (default)

// Normal stall detection behavior
```

### 8.8. Implementation Checklist

- [ ] Add `stallTimeout` field to `AnalyzedFlow` interface
- [ ] Implement `calculateFlowStallTimeout` in flow analyzer
- [ ] Update flow analysis to calculate stall timeout
- [ ] Include stall timeout in registry template
- [ ] Add `getFlowStallTimeout` method to stall detector
- [ ] Update `isStalled` to check awaiting steps
- [ ] Update `isStalled` to use per-flow timeout
- [ ] Update `checkFlowsForStalls` to skip awaiting flows
- [ ] Add activity tracking for await.registered events
- [ ] Add activity tracking for await.resolved events
- [ ] Update configuration types for await-aware stall detection
- [ ] Add tests for stall detection with await patterns
- [ ] Document stall detection behavior with awaits

### 8.9. Testing

**Test Cases:**

1. **Flow with long await should not be marked stalled**
   - Create flow with 1-hour webhook await
   - Wait 35 minutes (longer than default 30-min timeout)
   - Assert flow status is "running", not "stalled"

2. **Flow should be marked stalled after await-adjusted timeout**
   - Create flow with 1-hour webhook await
   - Wait 70 minutes (longer than await timeout + buffer)
   - Assert flow status is "stalled"

3. **Awaiting flow should not trigger stall detection**
   - Create flow with active await pattern
   - Run periodic stall check
   - Assert flow is skipped in stall check

4. **Flow without awaits uses default timeout**
   - Create flow without await patterns
   - Verify calculated stallTimeout is 30 minutes
   - Normal stall detection behavior applies

5. **Multiple awaits use additive timeout**
   - Create flow with 1-hour and 2-hour awaits
   - Verify calculated stallTimeout is sum of both (3 hours + buffer)

## 9. Flow UI Integration

### 8.1. Await Visualization

The flow UI can visualize await patterns using the analyzed flow metadata:

```typescript
// From analyzedFlow.steps
const step = analyzedFlow.steps.find(s => s.name === 'approve')

if (step.awaitBefore) {
  // Show "waiting" indicator before step execution
  // Display await type, timeout, and webhook URL if applicable
}

if (step.awaitAfter) {
  // Show "paused" indicator after step completes
  // Display await type and remaining time
}

// From runtime state (flow run index metadata)
const { SubjectPatterns } = useStreamTopics()
const indexKey = SubjectPatterns.flowRunIndex(flowName)
const flowEntry = await store.indexGet(indexKey, runId)
const awaitState = flowEntry?.metadata?.awaitingSteps?.[stepName]

if (awaitState) {
  // Update UI with current await status
  // Show awaiting type, position (before/after)
  // Display time elapsed / remaining
  const elapsed = Date.now() - awaitState.registeredAt
  const remaining = awaitState.timeoutAt 
    ? awaitState.timeoutAt - Date.now() 
    : null
}
```

### 8.2. Flow Lifecycle States

With await patterns, flow lifecycle gains new states:

```typescript
type StepStatus = 
  | 'pending'      // Not started, waiting for dependencies
  | 'awaiting'     // Waiting for external trigger (awaitBefore)
  | 'running'      // Executing handler
  | 'paused'       // Completed but awaiting (awaitAfter)
  | 'completed'    // Fully done
  | 'failed'       // Error occurred
  | 'timeout'      // Await pattern timed out
```

**Status Detection:**

```typescript
function getStepStatus(step, events, awaitState) {
  // Check await state first
  if (awaitState) {
    if (awaitState.position === 'before') return 'awaiting'
    if (awaitState.position === 'after') return 'paused'
  }
  
  // Check events
  const hasStarted = events.some(e => 
    e.type === 'step.started' && e.stepName === step.name
  )
  const hasCompleted = events.some(e => 
    e.type === 'step.completed' && e.stepName === step.name
  )
  const hasFailed = events.some(e => 
    e.type === 'step.failed' && e.stepName === step.name
  )
  
  if (hasFailed) return 'failed'
  if (hasCompleted) return 'completed'
  if (hasStarted) return 'running'
  return 'pending'
}
```

## 10. Implementation Checklist

### Phase 1: Flow Analyzer (Build Time)
- [ ] Extract `awaitBefore` from step configs
- [ ] Extract `awaitAfter` from step configs
- [ ] Add `hasAwaitPattern` flag to steps
- [ ] Generate flow-level await summary
- [ ] Calculate per-flow stall timeout based on await patterns
- [ ] Include await configs and stall timeout in registry template
- [ ] Update TypeScript types for analyzed flows

### Phase 2: Worker Context
- [ ] Add `ctx.trigger` field to RunContext
- [ ] Add `ctx.awaitConfig` field to RunContext
- [ ] Add `ctx.awaitState()` helper function
- [ ] Update `buildContext` to populate new fields
- [ ] Update TypeScript interface

### Phase 3: Lifecycle Hooks
- [ ] Create hook registry (`hookRegistry.ts`)
- [ ] Add hook extraction in worker loader
- [ ] Implement `registerHooks` function
- [ ] Implement `loadLifecycleHooks` function
- [ ] Export hook types for userland

### Phase 4: Worker Runner (Await Before)
- [ ] Load step config from registry
- [ ] Check for `awaitBefore` config
- [ ] Detect await resume (awaitResolved flag)
- [ ] Register await pattern
- [ ] Store await state in KV
- [ ] Call `onAwaitRegister` hook
- [ ] Publish `await.registered` event
- [ ] Return early without executing handler

### Phase 5: Worker Runner (Await After)
- [ ] Detect step completion
- [ ] Check for `awaitAfter` config
- [ ] Capture emitted events
- [ ] Store blocked emits in KV
- [ ] Register await pattern
- [ ] Store await state in KV
- [ ] Call `onAwaitRegister` hook
- [ ] Publish `await.registered` event

### Phase 6: Worker Runner (Resume)
- [ ] Detect await resume flag
- [ ] Populate `ctx.trigger` with resolved data
- [ ] Execute handler normally
- [ ] Clean up await state after completion

### Phase 7: Trigger Wiring
- [ ] Update `handleAwaitResolved` to detect position
- [ ] Call `onAwaitResolve` hook
- [ ] For awaitBefore: Re-queue step with awaitResolved flag
- [ ] For awaitAfter: Load and replay blocked emits
- [ ] Delete await state and blocked emits from KV
- [ ] Trigger `checkAndTriggerPendingSteps` after emit replay

### Phase 8: Flow Wiring
- [ ] Add await state check in `checkAndTriggerPendingSteps`
- [ ] Skip awaiting steps during step triggering
- [ ] Query index metadata for awaiting steps
- [ ] Log await status for debugging

### Phase 9: Stall Detection Integration
- [ ] Add `stallTimeout` to AnalyzedFlow interface
- [ ] Implement `calculateFlowStallTimeout` function
- [ ] Update flow analyzer to calculate stall timeout
- [ ] Add `getFlowStallTimeout` to stall detector
- [ ] Update `isStalled` to check awaiting steps
- [ ] Update `isStalled` to use per-flow timeout
- [ ] Update `checkFlowsForStalls` to skip awaiting flows
- [ ] Add activity tracking for await.registered events
- [ ] Add activity tracking for await.resolved events
- [ ] Update configuration types

### Phase 10: Testing
- [ ] Unit tests for await state detection
- [ ] Integration test: awaitBefore webhook
- [ ] Integration test: awaitAfter time delay
- [ ] Integration test: awaitBefore event
- [ ] Integration test: emit blocking
- [ ] Integration test: lifecycle hooks
- [ ] E2E test: Full approval flow
- [ ] E2E test: Timeout handling
- [ ] Test: Stall detection with long await patterns
- [ ] Test: Stall detection skips awaiting flows
- [ ] Test: Per-flow stall timeout calculation

### Phase 11: Documentation
- [ ] Update trigger-system.md with integration details
- [ ] Add examples for awaitBefore/awaitAfter
- [ ] Document lifecycle hooks API
- [ ] Update flow UI documentation
- [ ] Add troubleshooting guide

## 10. Migration Strategy

### For Existing Flows

Await patterns are purely additive - existing flows without `awaitBefore`/`awaitAfter` continue to work unchanged.

### Adding Await to Existing Step

1. Add `awaitBefore` or `awaitAfter` to step config
2. Optionally add lifecycle hooks (`onAwaitRegister`, `onAwaitResolve`)
3. Access resolved data via `ctx.trigger` in handler
4. No changes needed to calling code

### Example Migration

**Before:**
```typescript
export const config = defineFunctionConfig({
  queue: { name: 'approvals' },
  flow: {
    name: ['approval-flow'],
    role: 'step',
    step: 'process',
    subscribes: ['review.submitted']
  }
})

export default defineFunction(async (input, ctx) => {
  // Manual polling for approval
  const approval = await pollForApproval(input.reviewId)
  return { approved: approval.status }
})
```

**After:**
```typescript
export const config = defineFunctionConfig({
  queue: { name: 'approvals' },
  flow: {
    name: ['approval-flow'],
    role: 'step',
    step: 'process',
    subscribes: ['review.submitted'],
    awaitBefore: {
      type: 'webhook',
      path: '/approve/{runId}/{stepId}',
      timeout: 86400000  // 24 hours
    }
  }
})

export const onAwaitRegister = async (webhookUrl, stepData, ctx) => {
  // Send email with webhook link
  await sendApprovalEmail({
    to: stepData.reviewerEmail,
    approveUrl: webhookUrl
  })
}

export default defineFunction(async (input, ctx) => {
  // Approval data available in ctx.trigger
  const { approved } = ctx.trigger
  return { approved }
})
```

## 11. Performance Considerations

### KV Store Usage

Await patterns use KV store for state management:
- Each awaiting step: 1-3 KV operations (state, blocked emits, webhook routing)
- Auto-expire with TTL prevents orphaned data
- Consider KV capacity for high-volume flows

### Event Stream Size

For `awaitAfter`, emit events are temporarily buffered:
- Stored in KV, not event stream
- Replayed after resolution
- May cause duplicate events if resolution happens multiple times (handle idempotently)

### Queue Pressure

`awaitBefore` prevents handler execution:
- Job remains in queue in "awaiting" state
- May affect queue metrics/monitoring
- Consider separate queue for awaiting jobs if needed

## 12. Error Handling

### Timeout Handling

Already implemented in await pattern implementations:
```typescript
if (awaitConfig.timeout) {
  setTimeout(() => {
    eventBus.publish({
      type: 'await.timeout',
      runId,
      stepName,
      data: { 
        action: awaitConfig.timeoutAction || 'fail' 
      }
    })
  }, awaitConfig.timeout)
}
```

### Hook Failures

Lifecycle hooks should not block await registration:
```typescript
try {
  if (hooks?.onAwaitRegister) {
    await hooks.onAwaitRegister(webhookUrl, stepData, ctx)
  }
} catch (error) {
  logger.error('onAwaitRegister hook failed', { error })
  // Continue with await registration
}
```

### Missing Await State

If await state is missing during resolution:
```typescript
if (!awaitState) {
  logger.warn('Await state not found, assuming before', {
    runId,
    stepName
  })
  // Default to awaitBefore behavior (re-queue)
  await resumeStepAfterAwait(runId, stepName, resolvedData)
}
```

## 13. Await Pattern Cleanup

### 13.1. Problem Statement

Await patterns register external resources (webhook URLs, event listeners, scheduled jobs) that must be cleaned up when flows end to prevent:
- **Orphaned webhooks**: URLs that no longer have active awaits but still exist in KV storage
- **Memory leaks**: Event listeners not removed after flow completion
- **Unnecessary processing**: Webhooks firing after flow is already done/canceled
- **Security risks**: Exposed webhook URLs for completed/canceled flows

**Cleanup Scenarios:**
1. ✅ **Normal resolution**: Await resolves, cleanup happens automatically
2. ❌ **Flow cancellation**: User/system cancels flow with active awaits
3. ❌ **Flow stall**: Flow marked as stalled with active awaits
4. ❌ **Flow completion**: Flow completes with unresolved `awaitAfter` patterns
5. ❌ **Step failure**: Step fails after registering await but before resolution
6. ❌ **Timeout expiration**: KV TTL expires but webhook still registered

### 13.2. Cleanup Strategy

**Approach:**
1. Track all registered await patterns in flow run metadata
2. Clean up awaits when flow status changes to terminal state
3. Use event handlers for flow lifecycle events
4. Implement per-pattern cleanup logic (webhooks, events, schedules)

### 13.3. Flow Lifecycle Event Handling

**File**: `packages/nvent/src/runtime/events/wiring/flowWiring.ts`

Add cleanup handlers for terminal flow states:

```typescript
async function handleFlowCanceled(event: FlowCanceledEvent) {
  const logger = useNventLogger('flow-cleanup')
  const { flowName, runId, reason } = event
  
  logger.info('Flow canceled, cleaning up await patterns', {
    flowName,
    runId,
    reason
  })
  
  await cleanupFlowAwaits(flowName, runId, 'canceled')
}

async function handleFlowCompleted(event: FlowCompletedEvent) {
  const logger = useNventLogger('flow-cleanup')
  const { flowName, runId } = event
  
  logger.debug('Flow completed, cleaning up await patterns', {
    flowName,
    runId
  })
  
  await cleanupFlowAwaits(flowName, runId, 'completed')
}

async function handleFlowStalled(event: FlowStalledEvent) {
  const logger = useNventLogger('flow-cleanup')
  const { flowName, runId, reason } = event
  
  logger.warn('Flow stalled, cleaning up await patterns', {
    flowName,
    runId,
    reason
  })
  
  await cleanupFlowAwaits(flowName, runId, 'stalled')
}

async function handleFlowFailed(event: FlowFailedEvent) {
  const logger = useNventLogger('flow-cleanup')
  const { flowName, runId, error } = event
  
  logger.error('Flow failed, cleaning up await patterns', {
    flowName,
    runId,
    error
  })
  
  await cleanupFlowAwaits(flowName, runId, 'failed')
}
```

### 13.4. Cleanup Implementation

**File**: `packages/nvent/src/runtime/events/utils/awaitCleanup.ts` (new)

```typescript
import type { StoreAdapter } from '../../adapters/interfaces/store'
import { useNventLogger } from '../../logger'
import { useStreamTopics } from '../../stream/topics'

export async function cleanupFlowAwaits(
  flowName: string,
  runId: string,
  reason: 'completed' | 'canceled' | 'stalled' | 'failed'
): Promise<void> {
  const logger = useNventLogger('await-cleanup')
  const store = useStoreAdapter()
  const { SubjectPatterns } = useStreamTopics()
  
  try {
    // Get awaiting steps from flow run metadata
    const indexKey = SubjectPatterns.flowRunIndex(flowName)
    
    if (!store.indexGet) {
      logger.warn('Store does not support index operations, skipping cleanup')
      return
    }
    
    const flowEntry = await store.indexGet(indexKey, runId)
    const awaitingSteps = flowEntry?.metadata?.awaitingSteps || {}
    
    if (Object.keys(awaitingSteps).length === 0) {
      logger.debug('No awaiting steps to clean up', { flowName, runId })
      return
    }
    
    logger.info('Cleaning up await patterns', {
      flowName,
      runId,
      reason,
      awaitCount: Object.keys(awaitingSteps).length
    })
    
    // Clean up each await pattern
    const cleanupPromises = Object.entries(awaitingSteps).map(
      async ([stepName, awaitInfo]: [string, any]) => {
        try {
          await cleanupAwaitPattern(
            flowName,
            runId,
            stepName,
            awaitInfo,
            reason
          )
        } catch (error) {
          logger.error('Failed to clean up await pattern', {
            flowName,
            runId,
            stepName,
            error: (error as Error).message
          })
        }
      }
    )
    
    await Promise.all(cleanupPromises)
    
    // Clear awaitingSteps from metadata
    if (store.indexUpdateWithRetry) {
      await store.indexUpdateWithRetry(indexKey, runId, {
        awaitingSteps: {}
      })
    }
    
    logger.info('Await cleanup completed', {
      flowName,
      runId,
      cleanedCount: Object.keys(awaitingSteps).length
    })
  } catch (error) {
    logger.error('Failed to clean up flow awaits', {
      flowName,
      runId,
      error: (error as Error).message
    })
  }
}

async function cleanupAwaitPattern(
  flowName: string,
  runId: string,
  stepName: string,
  awaitInfo: any,
  reason: string
): Promise<void> {
  const logger = useNventLogger('await-cleanup')
  const store = useStoreAdapter()
  
  logger.debug('Cleaning up await pattern', {
    flowName,
    runId,
    stepName,
    awaitType: awaitInfo.awaitType,
    position: awaitInfo.position,
    reason
  })
  
  // Cleanup based on await type
  switch (awaitInfo.awaitType) {
    case 'webhook':
      await cleanupWebhookAwait(runId, stepName, awaitInfo, store)
      break
    
    case 'event':
      await cleanupEventAwait(runId, stepName, awaitInfo, store)
      break
    
    case 'schedule':
      await cleanupScheduleAwait(runId, stepName, awaitInfo, store)
      break
    
    case 'time':
      await cleanupTimeAwait(runId, stepName, awaitInfo, store)
      break
    
    default:
      logger.warn('Unknown await type, skipping cleanup', {
        awaitType: awaitInfo.awaitType
      })
  }
  
  // Clean up blocked emits if any (awaitAfter)
  if (awaitInfo.hasBlockedEmits && store.kv?.delete) {
    await store.kv.delete(`await:blocked-emits:${runId}:${stepName}`)
    logger.debug('Cleaned up blocked emits', { runId, stepName })
  }
}

async function cleanupWebhookAwait(
  runId: string,
  stepName: string,
  awaitInfo: any,
  store: StoreAdapter
): Promise<void> {
  const logger = useNventLogger('await-cleanup')
  
  if (!store.kv?.delete) return
  
  // Extract webhook ID from URL
  const webhookUrl = awaitInfo.webhookUrl
  if (webhookUrl) {
    const webhookId = extractWebhookId(webhookUrl)
    if (webhookId) {
      await store.kv.delete(`await:webhook:${webhookId}`)
      logger.debug('Cleaned up webhook routing', {
        runId,
        stepName,
        webhookId
      })
    }
  }
  
  // Clean up timeout tracker
  await store.kv.delete(`await:timeout:${runId}:${stepName}`)
}

async function cleanupEventAwait(
  runId: string,
  stepName: string,
  awaitInfo: any,
  store: StoreAdapter
): Promise<void> {
  const logger = useNventLogger('await-cleanup')
  
  if (!store.kv?.delete) return
  
  // Remove event subscription mapping
  await store.kv.delete(`await:event:${runId}:${stepName}`)
  
  // Clean up timeout tracker
  await store.kv.delete(`await:timeout:${runId}:${stepName}`)
  
  logger.debug('Cleaned up event subscription', { runId, stepName })
}

async function cleanupScheduleAwait(
  runId: string,
  stepName: string,
  awaitInfo: any,
  store: StoreAdapter
): Promise<void> {
  const logger = useNventLogger('await-cleanup')
  
  if (!store.kv?.delete) return
  
  // Cancel scheduled job if exists
  // This depends on scheduler implementation
  const scheduleKey = `await:schedule:${runId}:${stepName}`
  await store.kv.delete(scheduleKey)
  
  // Clean up timeout tracker
  await store.kv.delete(`await:timeout:${runId}:${stepName}`)
  
  logger.debug('Cleaned up schedule', { runId, stepName })
}

async function cleanupTimeAwait(
  runId: string,
  stepName: string,
  awaitInfo: any,
  store: StoreAdapter
): Promise<void> {
  const logger = useNventLogger('await-cleanup')
  
  if (!store.kv?.delete) return
  
  // Cancel time delay if exists
  // Timer references are in-memory, but we can clean up KV state
  await store.kv.delete(`await:time:${runId}:${stepName}`)
  
  // Clean up timeout tracker
  await store.kv.delete(`await:timeout:${runId}:${stepName}`)
  
  logger.debug('Cleaned up time delay', { runId, stepName })
}

function extractWebhookId(webhookUrl: string): string | null {
  // Extract webhook ID from URL
  // Example: https://api.example.com/webhook/abc123 -> abc123
  const match = webhookUrl.match(/webhook\/([^\/\?]+)/)
  return match ? match[1] : null
}
```

### 13.5. Webhook Security: Reject After Cleanup

**File**: `packages/nvent/src/runtime/triggers/webhook/handler.ts`

Update webhook handler to reject requests after cleanup:

```typescript
export async function handleWebhookRequest(
  webhookId: string,
  payload: any
): Promise<{ status: number; message: string }> {
  const logger = useNventLogger('webhook-handler')
  const store = useStoreAdapter()
  
  if (!store.kv?.get) {
    return { status: 500, message: 'KV store not available' }
  }
  
  // Look up webhook routing
  const routingKey = `await:webhook:${webhookId}`
  const routing = await store.kv.get(routingKey)
  
  if (!routing) {
    logger.warn('Webhook not found or expired', { webhookId })
    return {
      status: 410,  // Gone (resource no longer available)
      message: 'Webhook not found or has expired. The flow may have completed, been canceled, or timed out.'
    }
  }
  
  const { runId, stepName, awaitType, position } = routing
  
  // Double-check flow is still running and awaiting
  const { SubjectPatterns } = useStreamTopics()
  const flowName = routing.flowName
  const indexKey = SubjectPatterns.flowRunIndex(flowName)
  
  const flowEntry = await store.indexGet?.(indexKey, runId)
  
  if (!flowEntry) {
    logger.warn('Flow not found', { runId, stepName })
    await store.kv.delete(routingKey)  // Cleanup stale routing
    return {
      status: 404,
      message: 'Flow not found'
    }
  }
  
  if (flowEntry.metadata?.status !== 'running') {
    logger.warn('Flow is not running', {
      runId,
      stepName,
      status: flowEntry.metadata?.status
    })
    await store.kv.delete(routingKey)  // Cleanup stale routing
    return {
      status: 410,
      message: `Flow is ${flowEntry.metadata?.status}. Webhook no longer valid.`
    }
  }
  
  const awaitingSteps = flowEntry.metadata?.awaitingSteps || {}
  if (!awaitingSteps[stepName]) {
    logger.warn('Step is not awaiting', { runId, stepName })
    await store.kv.delete(routingKey)  // Cleanup stale routing
    return {
      status: 410,
      message: 'Step is no longer awaiting. Webhook has expired.'
    }
  }
  
  // Valid webhook, proceed with resolution
  logger.info('Webhook received', { webhookId, runId, stepName })
  
  // Publish await.resolved event
  const eventMgr = useEventManager()
  await eventMgr.publishBus({
    type: 'await.resolved',
    flowName,
    runId,
    stepName,
    triggerData: payload
  })
  
  return {
    status: 200,
    message: 'Webhook processed successfully'
  }
}
```

### 13.6. Stall Detection Integration

Update stall detector to trigger cleanup:

**File**: `packages/nvent/src/runtime/events/utils/stallDetector.ts`

```typescript
async markAsStalled(
  flowName: string,
  runId: string,
  reason: string
): Promise<void> {
  // ... existing stall marking logic
  
  // Trigger await cleanup
  try {
    const { cleanupFlowAwaits } = await import('./awaitCleanup')
    await cleanupFlowAwaits(flowName, runId, 'stalled')
  } catch (error) {
    this.logger.error('Failed to clean up awaits for stalled flow', {
      flowName,
      runId,
      error: (error as Error).message
    })
  }
}
```

### 13.7. Configuration

Add cleanup configuration options:

**File**: `packages/nvent/src/runtime/config/types.ts`

```typescript
export interface AwaitConfig {
  /**
   * Cleanup behavior for await patterns
   */
  cleanup?: {
    /**
     * Enable automatic cleanup of await patterns on flow termination
     * @default true
     */
    enabled?: boolean
    
    /**
     * Cleanup on flow completion (even if awaits unresolved)
     * @default true
     */
    onComplete?: boolean
    
    /**
     * Cleanup on flow cancellation
     * @default true
     */
    onCancel?: boolean
    
    /**
     * Cleanup on flow stalled
     * @default true
     */
    onStalled?: boolean
    
    /**
     * Cleanup on flow failure
     * @default true
     */
    onFailed?: boolean
    
    /**
     * Retry cleanup on failure
     * @default 3
     */
    retryCount?: number
  }
}
```

### 13.8. Testing

**Test Cases:**

1. **Webhook cleanup on flow cancellation**
   - Register webhook await
   - Cancel flow
   - Verify webhook KV entry deleted
   - Attempt webhook call returns 410 Gone

2. **Webhook cleanup on flow completion**
   - Flow completes with unresolved awaitAfter
   - Verify webhook cleaned up
   - Webhook call returns 410 Gone

3. **Webhook cleanup on stall detection**
   - Flow stalls with active await
   - Stall detector marks as stalled
   - Verify awaits cleaned up

4. **Blocked emits cleanup**
   - awaitAfter registered with blocked emits
   - Flow canceled
   - Verify blocked emits KV entry deleted

5. **Multiple awaits cleanup**
   - Flow with 3 steps, each with different await type
   - Flow canceled
   - Verify all 3 await patterns cleaned up

6. **Cleanup failure handling**
   - KV store fails during cleanup
   - Verify error logged but flow status updates

7. **Valid webhook after cleanup attempt**
   - Flow running with active await
   - Webhook called before cleanup
   - Verify webhook processes successfully

### 13.9. Event Wiring Registration

Register cleanup handlers in event bus:

**File**: `packages/nvent/src/runtime/events/wiring/index.ts`

```typescript
export function registerEventHandlers() {
  const eventBus = getEventBus()
  
  // ... existing handlers
  
  // Await cleanup handlers
  eventBus.on('flow.canceled', handleFlowCanceled)
  eventBus.on('flow.completed', handleFlowCompleted)
  eventBus.on('flow.stalled', handleFlowStalled)
  eventBus.on('flow.failed', handleFlowFailed)
}
```

### 13.10. Implementation Checklist

- [ ] Create `awaitCleanup.ts` utility module
- [ ] Implement `cleanupFlowAwaits` main function
- [ ] Implement per-pattern cleanup (webhook, event, schedule, time)
- [ ] Add cleanup handlers in flow wiring
- [ ] Update webhook handler to reject after cleanup (410 Gone)
- [ ] Integrate cleanup with stall detection
- [ ] Add cleanup to flow cancellation handler
- [ ] Add cleanup to flow completion handler
- [ ] Add cleanup to flow failure handler
- [ ] Add cleanup configuration options
- [ ] Register cleanup event handlers
- [ ] Add tests for all cleanup scenarios
- [ ] Document cleanup behavior

## 14. Future Enhancements

### Parallel Await Patterns

Support multiple awaits for a single step:
```typescript
awaitBefore: [
  { type: 'event', event: 'approval.manager' },
  { type: 'event', event: 'approval.finance' }
]
// Wait for ALL to resolve (AND logic)
```

### Conditional Await

Skip await based on input data:
```typescript
awaitBefore: {
  type: 'webhook',
  path: '/approve/{runId}',
  condition: 'amount > 1000'  // AST-safe expression
}
```

### Await Cancellation API

Allow explicit cancellation of await patterns:
```typescript
await cancelAwait(runId, stepName)
// Triggers cleanup immediately
// Optionally triggers timeout action
```

### Cleanup Monitoring

Track cleanup metrics and failures:
```typescript
// Metrics:
// - await.cleanup.success
// - await.cleanup.failed
// - await.cleanup.duration
// - await.webhook.orphaned (webhooks without routing)
```

---

**End of Specification**
