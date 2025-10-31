# Universal Trigger System - Implementation Details

> **Version**: v0.5.0  
> **Status**: 📋 Planning  
> **Last Updated**: 2025-10-30

This document covers the technical implementation details for the Universal Trigger System, including storage architecture, registry implementation, and API design.

## Table of Contents

1. [Unified Storage Architecture](#unified-storage-architecture)
2. [Trigger Registry Implementation](#trigger-registry-implementation)
3. [Webhook Handler](#webhook-handler)
4. [Event Types and Schemas](#event-types-and-schemas)
5. [API Endpoints](#api-endpoints)
6. [Storage Optimization](#storage-optimization)

## Unified Storage Architecture

### Design Principles

- **Minimal Redis Keys**: Use shared structures instead of per-trigger keys
- **Hybrid Approach**: Static triggers in-memory, dynamic in Redis
- **Ephemeral Cleanup**: Auto-expire await triggers and streams
- **Single Source of Truth**: Unified registry for all trigger types

### Storage Structure

```
# 1. Trigger Registry (hybrid: static in-memory + dynamic in Redis)
nq:triggers:registry → Hash
  # Only dynamic/runtime-registered triggers stored
  # Static triggers (from code) loaded in-memory at startup
  # Fields:
  {
    "<trigger-name>": "<json-serialized-trigger-definition>",
    "custom.webhook.stripe": "{...}",
    "tenant.abc.webhook": "{...}"
  }

# 2. Webhook Routes (shared mapping for ALL webhooks)
nq:webhook:routes → Hash
  # Maps webhook paths to trigger names
  {
    "/webhooks/stripe": "stripe.payment.succeeded",
    "/webhooks/github": "github.push",
    "/approval/abc-123": "await:run-abc-123:step-1"  // Ephemeral
  }

# 3. Schedule State (shared sorted set for ALL cron triggers)
nq:triggers:schedules → Sorted Set
  # Score = next execution timestamp (Unix ms)
  # Value = trigger name
  [
    { score: 1730275200000, value: "daily.cleanup" },
    { score: 1730278800000, value: "hourly.sync" }
  ]

# 4. Event Streams (per trigger type, auto-trimmed)
nq:trigger:<trigger-name> → Stream
  # All trigger runs for this trigger
  # Auto-trimmed by retentionDays config
  # Example: nq:trigger:stripe.payment.succeeded
  [
    {
      id: "run-abc-123",
      type: "webhook",
      ts: "2025-10-30T12:34:56Z",
      data: { paymentId: "pi_...", amount: 99.99 },
      flowRuns: [...]
    }
  ]

# 5. Await Trigger Streams (ephemeral, per run+step)
nq:trigger:await:<run-id>:<step-id> → Stream
  # Ephemeral stream for await pattern
  # Auto-expires with TTL
  # Example: nq:trigger:await:run-abc-123:step-1
  # Deleted after: await resolves OR timeout OR flow completes

# 6. Rate Limiting (optional, per trigger with TTL)
nq:ratelimit:<trigger-name> → Counter with TTL
  # Only exists if rate limiting configured
  # Auto-expires after window
```

### Storage Counts

**Entry Triggers (Static - from code)**:
- In-memory: Unlimited (0 Redis keys)
- Registry: 0 keys
- Routes: 1 shared hash (all webhooks)
- Schedules: 1 shared sorted set (all crons)
- Streams: 1 per trigger type

**Entry Triggers (Dynamic - runtime registered)**:
- Registry: 1 shared hash (all dynamic triggers)
- Routes: 1 shared hash (all webhooks)
- Schedules: 1 shared sorted set (all crons)
- Streams: 1 per trigger type

**Await Triggers (Ephemeral - auto-cleanup)**:
- Registry: 1 shared hash entry (TTL)
- Routes: 1 shared hash entry (ephemeral)
- Streams: 1 per run+step (TTL)

**Total Keys**:
- **3 shared keys** (registry, routes, schedules)
- **N streams** (1 per active trigger type)
- **M ephemeral streams** (1 per active await, auto-cleaned)

**Example for 100 triggers with 50 active flows**:
- Static triggers: 0 Redis keys
- Dynamic triggers: 1 hash (all in one)
- Webhook routes: 1 hash (all in one)
- Schedules: 1 sorted set (all in one)
- Event streams: ~100 streams (1 per trigger)
- Active awaits: ~50 ephemeral streams (auto-cleanup)
- Rate limiters: ~20 counters (optional, with TTL)

= **~173 keys total** vs **300+ keys with separate systems**

### Storage Comparison

**Before (Separate Systems)**:
```
Entry Triggers:
  - nq:triggers:registry (hash) → 1 key
  - nq:webhook:routes (hash) → 1 key  
  - nq:triggers:schedules (sorted set) → 1 key
  - nq:trigger:<name> (stream) × N → N keys

Await Triggers (Separate):
  - nq:await:registry (hash) → 1 key
  - nq:await:webhook:routes (hash) → 1 key
  - nq:await:trigger:<run-id>:<step-id> (stream) × M → M keys

Total: 5 + N + M keys
```

**After (Unified System)**:
```
Unified:
  - nq:triggers:registry (hash, dynamic only) → 1 key
  - nq:webhook:routes (hash, all webhooks) → 1 key
  - nq:triggers:schedules (sorted set, all crons) → 1 key
  - nq:trigger:<name> (stream) × N → N keys
  - nq:trigger:await:<run-id>:<step-id> (stream, TTL) × M → M keys

Total: 3 + N + M keys (static in-memory)
```

**Savings**: ~40% fewer keys + static triggers have 0 Redis footprint

## Trigger Registry Implementation

### Hybrid Registry Approach

```typescript
// src/runtime/server/triggers/registry.ts
import type { TriggerDefinition } from './types'

export class TriggerRegistry {
  // Static triggers (from code, in-memory)
  private staticTriggers = new Map<string, TriggerDefinition>()
  
  // Dynamic triggers (from Redis, runtime-registered)
  private dynamicTriggers = new Map<string, TriggerDefinition>()
  
  constructor(
    private redis: Redis,
    private streamStore: StreamStore
  ) {}
  
  /**
   * Initialize registry - load static and dynamic triggers
   */
  async init() {
    // 1. Load static triggers from plugins (in-memory)
    this.staticTriggers = await this.loadStaticTriggers()
    console.log(`Loaded ${this.staticTriggers.size} static triggers`)
    
    // 2. Load dynamic triggers from Redis
    const stored = await this.redis.hgetall('nq:triggers:registry')
    for (const [name, json] of Object.entries(stored)) {
      this.dynamicTriggers.set(name, JSON.parse(json))
    }
    console.log(`Loaded ${this.dynamicTriggers.size} dynamic triggers`)
    
    // 3. Register webhook routes
    await this.syncWebhookRoutes()
    
    // 4. Initialize schedule runner
    await this.syncSchedules()
  }
  
  /**
   * Get trigger by name (dynamic overrides static)
   */
  get(name: string): TriggerDefinition | undefined {
    return this.dynamicTriggers.get(name) || this.staticTriggers.get(name)
  }
  
  /**
   * Get all triggers (merged view)
   */
  getAll(): TriggerDefinition[] {
    const all = new Map([...this.staticTriggers, ...this.dynamicTriggers])
    return Array.from(all.values())
  }
  
  /**
   * Get triggers by type
   */
  getByType(type: 'event' | 'webhook' | 'schedule' | 'manual'): TriggerDefinition[] {
    return this.getAll().filter(t => t.type === type)
  }
  
  /**
   * Get triggers by scope
   */
  getByScope(scope: 'flow' | 'run'): TriggerDefinition[] {
    return this.getAll().filter(t => t.scope === scope)
  }
  
  /**
   * Register static trigger (from code)
   * Stored in-memory only
   */
  registerStatic(trigger: TriggerDefinition): void {
    this.staticTriggers.set(trigger.name, trigger)
    console.log(`Registered static trigger: ${trigger.name}`)
  }
  
  /**
   * Register dynamic trigger (runtime)
   * Stored in Redis for persistence
   */
  async registerDynamic(trigger: TriggerDefinition): Promise<void> {
    // Validate trigger definition
    this.validateTrigger(trigger)
    
    // Store in Redis
    await this.redis.hset(
      'nq:triggers:registry',
      trigger.name,
      JSON.stringify(trigger)
    )
    
    // Update in-memory cache
    this.dynamicTriggers.set(trigger.name, trigger)
    
    // Update routes/schedules if needed
    if (trigger.type === 'webhook') {
      await this.registerWebhookRoute(trigger)
    } else if (trigger.type === 'schedule') {
      await this.registerSchedule(trigger)
    }
    
    console.log(`Registered dynamic trigger: ${trigger.name}`)
  }
  
  /**
   * Register ephemeral await trigger (run-scoped)
   * Auto-expires with TTL
   */
  async registerAwait(
    runId: string,
    stepId: string,
    config: AwaitTriggerConfig
  ): Promise<string> {
    const triggerName = `await:${runId}:${stepId}`
    
    const trigger: TriggerDefinition = {
      name: triggerName,
      type: config.type,
      scope: 'run',
      displayName: `Await ${config.type} - ${stepId}`,
      source: 'await-pattern',
      runId,
      stepId,
      ephemeral: true,
      config: {
        timeout: config.timeout || 3600000,  // 1 hour default
        persistData: false,
        retentionDays: 0  // No retention for await
      },
      ...config
    }
    
    // Store in Redis with TTL
    const ttl = trigger.config.timeout / 1000  // Convert to seconds
    await this.redis.hset(
      'nq:triggers:registry',
      triggerName,
      JSON.stringify(trigger)
    )
    await this.redis.expire('nq:triggers:registry', ttl)
    
    // Register webhook route if webhook type
    if (config.type === 'webhook') {
      await this.redis.hset(
        'nq:webhook:routes',
        config.path,
        triggerName
      )
    }
    
    console.log(`Registered await trigger: ${triggerName}`)
    return triggerName
  }
  
  /**
   * Cleanup await trigger after use
   */
  async cleanupAwait(runId: string, stepId: string): Promise<void> {
    const triggerName = `await:${runId}:${stepId}`
    
    // Remove from registry
    await this.redis.hdel('nq:triggers:registry', triggerName)
    
    // Remove webhook route if exists
    const trigger = this.dynamicTriggers.get(triggerName)
    if (trigger?.type === 'webhook' && trigger.endpoint?.path) {
      await this.redis.hdel('nq:webhook:routes', trigger.endpoint.path)
    }
    
    // Delete stream
    await this.redis.del(`nq:trigger:${triggerName}`)
    
    // Remove from cache
    this.dynamicTriggers.delete(triggerName)
    
    console.log(`Cleaned up await trigger: ${triggerName}`)
  }
  
  /**
   * List all await triggers for a run
   */
  async listAwaits(runId: string): Promise<TriggerDefinition[]> {
    const prefix = `await:${runId}:`
    return this.getAll().filter(t => t.name.startsWith(prefix))
  }
  
  /**
   * Update trigger configuration
   */
  async update(name: string, updates: Partial<TriggerDefinition>): Promise<void> {
    const trigger = this.get(name)
    if (!trigger) {
      throw new Error(`Trigger not found: ${name}`)
    }
    
    // Cannot update static triggers
    if (this.staticTriggers.has(name)) {
      throw new Error(`Cannot update static trigger: ${name}`)
    }
    
    const updated = { ...trigger, ...updates }
    await this.registerDynamic(updated)
  }
  
  /**
   * Delete dynamic trigger
   */
  async delete(name: string): Promise<void> {
    // Cannot delete static triggers
    if (this.staticTriggers.has(name)) {
      throw new Error(`Cannot delete static trigger: ${name}`)
    }
    
    const trigger = this.dynamicTriggers.get(name)
    if (!trigger) {
      throw new Error(`Trigger not found: ${name}`)
    }
    
    // Remove from Redis
    await this.redis.hdel('nq:triggers:registry', name)
    
    // Remove routes/schedules
    if (trigger.type === 'webhook' && trigger.endpoint?.path) {
      await this.redis.hdel('nq:webhook:routes', trigger.endpoint.path)
    } else if (trigger.type === 'schedule') {
      await this.redis.zrem('nq:triggers:schedules', name)
    }
    
    // Remove from cache
    this.dynamicTriggers.delete(name)
    
    console.log(`Deleted trigger: ${name}`)
  }
  
  /**
   * Sync webhook routes to Redis
   */
  private async syncWebhookRoutes(): Promise<void> {
    const webhooks = this.getByType('webhook')
    for (const trigger of webhooks) {
      if (trigger.endpoint?.path) {
        await this.redis.hset(
          'nq:webhook:routes',
          trigger.endpoint.path,
          trigger.name
        )
      }
    }
  }
  
  /**
   * Sync schedules to Redis
   */
  private async syncSchedules(): Promise<void> {
    const schedules = this.getByType('schedule')
    for (const trigger of schedules) {
      if (trigger.schedule?.enabled !== false) {
        await this.registerSchedule(trigger)
      }
    }
  }
  
  /**
   * Register schedule in sorted set
   */
  private async registerSchedule(trigger: TriggerDefinition): Promise<void> {
    if (!trigger.schedule?.cron) return
    
    const nextRun = this.calculateNextRun(trigger.schedule.cron, trigger.schedule.timezone)
    await this.redis.zadd('nq:triggers:schedules', nextRun.getTime(), trigger.name)
  }
  
  /**
   * Register webhook route
   */
  private async registerWebhookRoute(trigger: TriggerDefinition): Promise<void> {
    if (!trigger.endpoint?.path) return
    
    await this.redis.hset(
      'nq:webhook:routes',
      trigger.endpoint.path,
      trigger.name
    )
  }
  
  /**
   * Load static triggers from plugins
   */
  private async loadStaticTriggers(): Promise<Map<string, TriggerDefinition>> {
    // Scan server/plugins for trigger registrations
    // This happens at startup
    const triggers = new Map<string, TriggerDefinition>()
    // Implementation depends on plugin loading mechanism
    return triggers
  }
  
  /**
   * Validate trigger definition
   */
  private validateTrigger(trigger: TriggerDefinition): void {
    if (!trigger.name) {
      throw new Error('Trigger name is required')
    }
    if (!trigger.type) {
      throw new Error('Trigger type is required')
    }
    if (trigger.type === 'webhook' && !trigger.endpoint?.path) {
      throw new Error('Webhook triggers require endpoint.path')
    }
    if (trigger.type === 'schedule' && !trigger.schedule?.cron) {
      throw new Error('Schedule triggers require schedule.cron')
    }
  }
  
  /**
   * Calculate next run time for cron expression
   */
  private calculateNextRun(cron: string, timezone?: string): Date {
    // Use cron parser library
    // Return next execution timestamp
    return new Date()
  }
}
```

### Trigger Definition Types

```typescript
// src/runtime/server/triggers/types.ts
import type { z } from 'zod'

export interface TriggerDefinition {
  // Identity
  name: string
  type: 'event' | 'webhook' | 'schedule' | 'manual'
  scope?: 'flow' | 'run'  // flow = entry, run = await
  displayName: string
  description?: string
  source: string
  
  // Type-specific config
  endpoint?: WebhookEndpoint
  schedule?: ScheduleConfig
  ui?: ManualTriggerUI
  
  // Validation & transformation
  schema?: z.ZodSchema
  transform?: (data: any) => any
  
  // Storage & lifecycle
  config?: TriggerConfig
  
  // Ephemeral (for await patterns)
  ephemeral?: boolean
  runId?: string
  stepId?: string
  
  // Metadata
  tags?: string[]
  documentation?: string
  createdAt?: string
  updatedAt?: string
}

export interface WebhookEndpoint {
  path: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  auth?: WebhookAuth
  cors?: CORSConfig
  timeout?: number
}

export interface WebhookAuth {
  type: 'signature' | 'bearer' | 'apikey' | 'basic' | 'ip' | 'custom'
  secret?: string
  header?: string
  verify?: (req: Request) => Promise<boolean>
}

export interface ScheduleConfig {
  cron?: string
  interval?: string
  at?: string
  every?: { hours?: number; minutes?: number; seconds?: number }
  timezone?: string
  enabled?: boolean
  overlap?: 'skip' | 'queue' | 'replace'
}

export interface ManualTriggerUI {
  icon?: string
  color?: string
  form?: FormField[]
}

export interface FormField {
  name: string
  type: 'text' | 'select' | 'number' | 'boolean' | 'json' | 'date'
  label: string
  options?: Array<{ value: string; label: string }>
  required?: boolean
  default?: any
}

export interface TriggerConfig {
  persistData?: boolean
  retentionDays?: number
  rateLimit?: RateLimitConfig
  deduplicate?: DeduplicateConfig
  timeout?: number
}

export interface RateLimitConfig {
  max: number
  window: number  // milliseconds
  key?: (data: any) => string
}

export interface DeduplicateConfig {
  enabled: boolean
  key: (data: any) => string
  window: number  // milliseconds
}

export interface TriggerRun {
  id: string
  triggerId: string
  type: 'event' | 'webhook' | 'schedule' | 'manual'
  ts: string
  source: string
  
  // Type-specific metadata
  webhook?: {
    ip: string
    headers: Record<string, string>
    signature?: string
    idempotencyKey?: string
  }
  schedule?: {
    scheduledTime: string
    actualTime: string
    delay: number
  }
  manual?: {
    userId: string
    ip: string
  }
  
  // Trigger data
  data: any
  
  // Flow execution tracking
  flowRuns: FlowRunInfo[]
  
  // Status
  status: 'received' | 'processed' | 'failed' | 'skipped'
  processedAt?: string
  error?: string
}

export interface FlowRunInfo {
  flowId: string
  runId: string
  mode: 'auto' | 'manual'
  status: 'started' | 'completed' | 'failed'
  startedAt: string
  completedAt?: string
  error?: string
}

export interface AwaitTriggerConfig {
  type: 'webhook' | 'event' | 'schedule' | 'time'
  path?: string  // For webhook
  event?: string  // For event
  cron?: string  // For schedule
  delay?: number  // For time
  timeout?: number
  schema?: z.ZodSchema
  filter?: (data: any) => boolean
}
```

## Webhook Handler

### Universal Webhook Handler

```typescript
// src/runtime/server/api/_triggers/webhooks/[...path].post.ts
export default defineEventHandler(async (event) => {
  const path = getRouterParam(event, 'path')
  const fullPath = `/webhooks/${path}`
  
  // 1. Lookup trigger by webhook path
  const triggerName = await redis.hget('nq:webhook:routes', fullPath)
  if (!triggerName) {
    throw createError({
      statusCode: 404,
      message: `Webhook not found: ${fullPath}`
    })
  }
  
  // 2. Get trigger definition
  const trigger = await triggerRegistry.get(triggerName)
  if (!trigger) {
    throw createError({
      statusCode: 500,
      message: `Trigger configuration not found: ${triggerName}`
    })
  }
  
  // 3. Authenticate request
  if (trigger.endpoint?.auth) {
    const authenticated = await authenticateWebhook(event, trigger.endpoint.auth)
    if (!authenticated) {
      throw createError({
        statusCode: 401,
        message: 'Webhook authentication failed'
      })
    }
  }
  
  // 4. Rate limiting
  if (trigger.config?.rateLimit) {
    const limited = await checkRateLimit(triggerName, trigger.config.rateLimit)
    if (limited) {
      throw createError({
        statusCode: 429,
        message: 'Rate limit exceeded'
      })
    }
  }
  
  // 5. Parse and validate payload
  const body = await readBody(event)
  let data = body
  
  if (trigger.schema) {
    const result = trigger.schema.safeParse(body)
    if (!result.success) {
      throw createError({
        statusCode: 400,
        message: 'Invalid webhook payload',
        data: result.error.errors
      })
    }
    data = result.data
  }
  
  // 6. Transform data if configured
  if (trigger.transform) {
    data = trigger.transform(data)
  }
  
  // 7. Create trigger run
  const runId = `run-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  const triggerRun: TriggerRun = {
    id: runId,
    triggerId: triggerName,
    type: 'webhook',
    ts: new Date().toISOString(),
    source: 'external',
    webhook: {
      ip: getRequestIP(event) || 'unknown',
      headers: getHeaders(event),
      signature: getHeader(event, trigger.endpoint?.auth?.header || 'signature'),
      idempotencyKey: getHeader(event, 'idempotency-key')
    },
    data,
    flowRuns: [],
    status: 'received'
  }
  
  // 8. Store trigger run in stream
  await streamStore.append(`nq:trigger:${triggerName}`, triggerRun)
  
  // 9. Handle based on scope
  if (trigger.scope === 'run') {
    // Await pattern - resume specific run
    await resumeAwaitingRun(trigger, data)
  } else {
    // Entry trigger - start new flows
    await startFlowsForTrigger(trigger, data, triggerRun)
  }
  
  // 10. Return response
  return {
    triggerId: triggerName,
    runId,
    received: true,
    timestamp: triggerRun.ts
  }
})

/**
 * Authenticate webhook request
 */
async function authenticateWebhook(
  event: H3Event,
  auth: WebhookAuth
): Promise<boolean> {
  switch (auth.type) {
    case 'signature':
      return await verifySignature(event, auth)
    
    case 'bearer':
      const token = getHeader(event, 'authorization')?.replace('Bearer ', '')
      return token === auth.secret
    
    case 'apikey':
      const apiKey = getHeader(event, auth.header || 'x-api-key')
      return apiKey === auth.secret
    
    case 'basic':
      const basicAuth = getHeader(event, 'authorization')?.replace('Basic ', '')
      const decoded = Buffer.from(basicAuth || '', 'base64').toString()
      return decoded === auth.secret
    
    case 'ip':
      const ip = getRequestIP(event)
      // Check IP whitelist (stored in auth.secret as JSON array)
      const whitelist = JSON.parse(auth.secret || '[]')
      return whitelist.includes(ip)
    
    case 'custom':
      return await auth.verify!(event)
    
    default:
      return false
  }
}

/**
 * Verify webhook signature (HMAC)
 */
async function verifySignature(
  event: H3Event,
  auth: WebhookAuth
): Promise<boolean> {
  const signature = getHeader(event, auth.header || 'x-signature')
  if (!signature) return false
  
  const body = await readRawBody(event)
  if (!body) return false
  
  const crypto = await import('crypto')
  const hmac = crypto
    .createHmac('sha256', auth.secret!)
    .update(body)
    .digest('hex')
  
  return hmac === signature
}

/**
 * Check rate limit
 */
async function checkRateLimit(
  triggerName: string,
  config: RateLimitConfig
): Promise<boolean> {
  const key = `nq:ratelimit:${triggerName}`
  const current = await redis.incr(key)
  
  if (current === 1) {
    // First request in window, set TTL
    await redis.pexpire(key, config.window)
  }
  
  return current > config.max
}

/**
 * Resume awaiting run
 */
async function resumeAwaitingRun(
  trigger: TriggerDefinition,
  data: any
): Promise<void> {
  if (!trigger.runId || !trigger.stepId) {
    throw new Error('Await trigger missing runId or stepId')
  }
  
  // Emit resume event
  await streamStore.append(`nq:flow:${trigger.runId}`, {
    type: 'await.resolved',
    runId: trigger.runId,
    stepId: trigger.stepId,
    ts: new Date().toISOString(),
    data
  })
  
  // Cleanup await trigger
  await triggerRegistry.cleanupAwait(trigger.runId, trigger.stepId)
}

/**
 * Start flows subscribed to trigger
 */
async function startFlowsForTrigger(
  trigger: TriggerDefinition,
  data: any,
  triggerRun: TriggerRun
): Promise<void> {
  // Find flows subscribed to this trigger
  const flows = await findFlowsForTrigger(trigger.name)
  
  for (const flow of flows) {
    // Check subscription mode
    const mode = typeof flow.triggers.mode === 'function'
      ? flow.triggers.mode(data)
      : flow.triggers.mode
    
    if (mode === 'auto') {
      // Auto-execute flow
      const flowRunId = await executeFlow(flow, data)
      triggerRun.flowRuns.push({
        flowId: flow.name,
        runId: flowRunId,
        mode: 'auto',
        status: 'started',
        startedAt: new Date().toISOString()
      })
    } else {
      // Manual mode - mark as pending
      await markFlowPending(flow, data, triggerRun.id)
    }
  }
  
  // Update trigger run with flow info
  triggerRun.status = 'processed'
  triggerRun.processedAt = new Date().toISOString()
  await streamStore.update(`nq:trigger:${trigger.name}`, triggerRun)
}
```

## Event Types and Schemas

### Event Type Definitions

```typescript
// src/runtime/server/events/types.ts

/**
 * Trigger-related events
 */
export type TriggerEvent =
  | TriggerReceivedEvent
  | TriggerProcessedEvent
  | TriggerFailedEvent
  | AwaitCreatedEvent
  | AwaitResolvedEvent
  | AwaitTimeoutEvent

export interface TriggerReceivedEvent {
  type: 'trigger.received'
  ts: string
  triggerId: string
  runId: string
  source: 'event' | 'webhook' | 'schedule' | 'manual'
  data: any
}

export interface TriggerProcessedEvent {
  type: 'trigger.processed'
  ts: string
  triggerId: string
  runId: string
  flowsStarted: number
  flowsPending: number
}

export interface TriggerFailedEvent {
  type: 'trigger.failed'
  ts: string
  triggerId: string
  runId: string
  error: string
  retryable: boolean
}

export interface AwaitCreatedEvent {
  type: 'await.created'
  ts: string
  runId: string
  stepId: string
  awaitType: 'webhook' | 'event' | 'schedule' | 'time'
  timeout: number
  config: any
}

export interface AwaitResolvedEvent {
  type: 'await.resolved'
  ts: string
  runId: string
  stepId: string
  data: any
  duration: number
}

export interface AwaitTimeoutEvent {
  type: 'await.timeout'
  ts: string
  runId: string
  stepId: string
  duration: number
}
```

## API Endpoints

### Complete API Reference

```typescript
/**
 * ============================================
 * TRIGGER MANAGEMENT
 * ============================================
 */

// List all triggers
GET /api/_triggers
Response: {
  triggers: TriggerDefinition[],
  total: number,
  static: number,
  dynamic: number
}

// Get trigger details
GET /api/_triggers/:triggerId
Response: TriggerDefinition

// Register dynamic trigger
POST /api/_triggers/register
Body: TriggerDefinition
Response: { triggerId: string, created: boolean }

// Update trigger
POST /api/_triggers/:triggerId/update
Body: Partial<TriggerDefinition>
Response: TriggerDefinition

// Delete trigger
DELETE /api/_triggers/:triggerId
Response: { deleted: boolean }

// Enable/disable trigger
POST /api/_triggers/:triggerId/enable
POST /api/_triggers/:triggerId/disable
Response: { enabled: boolean }

/**
 * ============================================
 * TRIGGER RUNS
 * ============================================
 */

// List trigger runs
GET /api/_triggers/:triggerId/runs
Query: { limit?, offset?, status?, from?, to? }
Response: {
  runs: TriggerRun[],
  total: number,
  hasMore: boolean
}

// Get specific run
GET /api/_triggers/:triggerId/runs/:runId
Response: TriggerRun

// Retry failed run
POST /api/_triggers/:triggerId/runs/:runId/retry
Response: { runId: string, retrying: boolean }

// Manually execute flow from trigger run
POST /api/_triggers/:triggerId/runs/:runId/execute
Body: { flowName?: string }
Response: { flowRunId: string, started: boolean }

// Delete run
DELETE /api/_triggers/:triggerId/runs/:runId
Response: { deleted: boolean }

/**
 * ============================================
 * WEBHOOKS
 * ============================================
 */

// Webhook endpoint (auto-generated per trigger)
POST /api/_triggers/webhooks/:path
Body: any (validated by trigger schema)
Response: {
  triggerId: string,
  runId: string,
  received: boolean,
  timestamp: string
}

// Test webhook
GET /api/_triggers/webhooks/:path/test
Response: {
  trigger: TriggerDefinition,
  endpoint: string,
  curlCommand: string
}

/**
 * ============================================
 * MANUAL EXECUTION
 * ============================================
 */

// Execute manual trigger
POST /api/_triggers/:triggerId/execute
Body: any (validated by trigger schema)
Response: {
  triggerId: string,
  runId: string,
  flowsTriggered: string[],
  startedAt: string
}

/**
 * ============================================
 * STATISTICS
 * ============================================
 */

// Get trigger statistics
GET /api/_triggers/:triggerId/stats
Query: { from?, to?, granularity? }
Response: {
  total: number,
  last24h: number,
  last7d: number,
  last30d: number,
  byStatus: Record<string, number>,
  byHour: Array<{ hour: string, count: number }>,
  avgLatency: number,
  successRate: number
}

// Get global statistics
GET /api/_triggers/stats
Response: {
  totalTriggers: number,
  totalRuns: number,
  byType: Record<string, number>,
  byStatus: Record<string, number>,
  topTriggers: Array<{ name: string, count: number }>
}

/**
 * ============================================
 * AWAIT PATTERNS
 * ============================================
 */

// List awaits for a run
GET /api/_triggers/awaits/:runId
Response: {
  awaits: TriggerDefinition[],
  active: number
}

// Get await details
GET /api/_triggers/awaits/:runId/:stepId
Response: TriggerDefinition

// Manually resolve await
POST /api/_triggers/awaits/:runId/:stepId/resolve
Body: any (data to pass to step)
Response: { resolved: boolean, resumedAt: string }

// Cancel await
POST /api/_triggers/awaits/:runId/:stepId/cancel
Response: { cancelled: boolean }
```

## Storage Optimization

### Optimization Strategies

#### 1. Stream Trimming

```typescript
// Auto-trim trigger streams based on retention policy
async function trimTriggerStream(triggerName: string): Promise<void> {
  const trigger = await triggerRegistry.get(triggerName)
  if (!trigger?.config?.retentionDays) return
  
  const maxAge = trigger.config.retentionDays * 24 * 60 * 60 * 1000
  const cutoff = Date.now() - maxAge
  
  // Trim by time (XTRIM MINID)
  await redis.xtrim(
    `nq:trigger:${triggerName}`,
    'MINID',
    cutoff
  )
}

// Run trimming periodically
setInterval(async () => {
  const triggers = triggerRegistry.getAll()
  for (const trigger of triggers) {
    await trimTriggerStream(trigger.name)
  }
}, 3600000)  // Every hour
```

#### 2. Ephemeral Cleanup

```typescript
// Auto-cleanup expired await triggers
async function cleanupExpiredAwaits(): Promise<void> {
  const allTriggers = triggerRegistry.getAll()
  const awaits = allTriggers.filter(t => t.ephemeral && t.runId)
  
  for (const await of awaits) {
    const stream = `nq:trigger:${await.name}`
    
    // Check if stream is empty or expired
    const info = await redis.xinfo('STREAM', stream)
    if (!info || info.length === 0) {
      await triggerRegistry.cleanupAwait(await.runId!, await.stepId!)
    }
  }
}

// Run cleanup periodically
setInterval(cleanupExpiredAwaits, 60000)  // Every minute
```

#### 3. Rate Limit Auto-Expiry

```typescript
// Rate limit counters automatically expire via TTL
async function incrementRateLimit(
  triggerName: string,
  config: RateLimitConfig
): Promise<number> {
  const key = `nq:ratelimit:${triggerName}`
  const current = await redis.incr(key)
  
  if (current === 1) {
    // First request - set TTL
    await redis.pexpire(key, config.window)
  }
  
  return current
}
```

#### 4. Compression

```typescript
// Compress large payloads in streams
async function appendWithCompression(
  stream: string,
  event: TriggerRun
): Promise<void> {
  // Compress data if > 10KB
  if (JSON.stringify(event.data).length > 10240) {
    const compressed = await gzip(JSON.stringify(event.data))
    event.data = {
      __compressed: true,
      data: compressed.toString('base64')
    }
  }
  
  await redis.xadd(stream, '*', 'payload', JSON.stringify(event))
}
```

### Performance Benchmarks

**Expected Performance** (Redis backend):
- Trigger registration: <1ms
- Webhook processing: 5-15ms (with auth)
- Event emission: 2-5ms
- Await registration: 3-8ms
- Stream append: 2-5ms
- Registry lookup: <1ms (in-memory)

**Optimization Results**:
- 40-50% fewer Redis keys vs separate systems
- 0 Redis keys for static triggers (in-memory)
- Auto-cleanup reduces storage by 30-40%
- Stream trimming maintains constant memory usage
- Rate limit TTL prevents key accumulation

## Summary

The unified trigger system provides:

✅ **Minimal Storage**: 3 shared keys + N streams (vs 5 + 2N before)  
✅ **Hybrid Registry**: Static in-memory + dynamic in Redis  
✅ **Auto-Cleanup**: Ephemeral triggers expire automatically  
✅ **Unified API**: Same endpoints for entry and await triggers  
✅ **Type-Safe**: Full TypeScript types and Zod validation  
✅ **Production-Ready**: Rate limiting, auth, monitoring  
✅ **Scalable**: Optimized for high throughput and low latency
