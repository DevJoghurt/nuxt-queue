# Universal Trigger System - Events, Webhooks, Schedules & Await Patterns

> **Version**: v0.5.0  
> **Status**: 📋 Planning  
> **Last Updated**: 2025-11-19  
> **Migration Note**: ⚠️ This will replace the simple v0.4 scheduling implementation (see [v0.4 Flow Scheduling](../v0.4/flow-scheduling.md))

## Goal

Build a comprehensive trigger system that unifies ALL ways flows interact with external events - whether starting a flow or waiting for external signals within a step.

This replaces the temporary v0.4 scheduling solution with a complete trigger infrastructure supporting events, webhooks, schedules, and config-based await patterns that work with queue systems like BullMQ and FastQ.

## Core Concept

Triggers serve two purposes:
1. **Entry Triggers** - Start new flow runs (flow entry points)
2. **Await Triggers** - Wait for external signals before/after step execution

**Key Constraints**: 
1. Queue systems like BullMQ and FastQ cannot pause execution mid-job. Therefore, await triggers must be **config-based** rather than programmatic.
2. Configuration is parsed via **AST (Abstract Syntax Tree)**, so **no functions allowed in config**. Use exported lifecycle hooks instead.

Both use the same trigger infrastructure with different scoping:
- Entry triggers are **flow-scoped** (start any run)
- Await triggers are **run-scoped** (wait before or after specific step)

**Config vs Programmatic**:
- ✅ **Trigger registration** (`registerTrigger`) - Programmatic, functions allowed
- ✅ **Flow config** (`defineFunctionConfig`) - AST-parsed, no functions
- ✅ **Lifecycle hooks** - Exported separately, full function support

**Hybrid Registration** (v0.5):
- 🔄 **Runtime Auto-Discovery** - Triggers/subscriptions auto-registered from file-based configs
- 🔧 **Programmatic API** - Runtime registration via `registerTrigger()` / `subscribeTrigger()`
- ✅ **Both Active** - Change configs on the fly (runtime) or during dev (programmatic)
- ✅ **Flexible** - Mix and match both approaches as needed

**Subscription Direction**:
- ➡️ **One-Way** - Flows subscribe to triggers (loose coupling)
- 🔍 **Optional Hints** - Triggers can declare expected subscribers (validation only)
- 🔄 **Runtime Index** - System builds bidirectional index automatically

## Unified Trigger Architecture

```
┌─────────────────────────────────────────────────────┐
│              Trigger Sources                        │
│  • Module Events      • External Webhooks           │
│  • Cron Schedules     • Manual Actions              │
│  • Time Delays        • Approval Requests           │
└────────────────┬────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────┐
│           Universal Trigger System                  │
│                                                     │
│  ┌─────────────────────────────────────────────┐  │
│  │  Trigger Registry                           │  │
│  │  - Static (from code)                       │  │
│  │  - Dynamic (runtime registered)             │  │
│  │  - Ephemeral (await-generated)              │  │
│  └─────────────────────────────────────────────┘  │
│                                                     │
│  Routing:                                          │
│  • Flow-scoped → Start new run                    │
│  • Run-scoped → Resume existing run               │
└────────────────┬────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────┐
│         Flow Execution / Resume                     │
└─────────────────────────────────────────────────────┘
```

## 1. Entry Triggers (Flow-Scoped)

Start new flow runs from external sources.

### Configuration

#### Approach 1: File-Based Config (Runtime Auto-Discovery)

```typescript
// server/functions/payment-flow/start.ts
// Flow subscribes to trigger (config-based, auto-discovered)
export const config = defineQueueConfig({
  flow: {
    names: ['payment-flow'],
    role: 'entry',
    step: 'start',
    // CLEAR NAMING: "triggers" for starting flows
    triggers: {
      // Subscribe to existing triggers
      subscribe: [
        'stripe.payment.succeeded',
        'manual.process.payment'
      ],
      mode: 'auto'  // or 'manual'
    }
  }
})

export default defineFunction(async (input, ctx) => {
  // Process payment event
  return { started: true }
})
```

✅ **Pros**: File-based, discoverable, hot-reload friendly  
🔄 **Runtime**: Auto-registered on server start

#### Approach 2: Programmatic API (Runtime Registration)

```typescript
// server/plugins/paymentFlows.ts
// Subscribe to trigger programmatically at runtime
export default defineNitroPlugin((nitro) => {
  const { subscribeTrigger } = useTriggers()
  
  // Runtime subscription (dynamic)
  subscribeTrigger({
    trigger: 'stripe.payment.succeeded',
    flow: 'payment-flow',
    mode: 'auto',
    // Optional: Programmatic config
    filter: (data) => data.amount > 100,  // Only large payments
    transform: (data) => ({ orderId: data.metadata.orderId })
  })
  
  // Can also be conditional/dynamic
  if (nitro.options.dev) {
    subscribeTrigger({
      trigger: 'dev.test.payment',
      flow: 'payment-flow',
      mode: 'auto'
    })
  }
})
```

✅ **Pros**: Dynamic, conditional, runtime changes  
🔧 **Runtime**: Can register/unregister during execution

#### Approach 3: Hybrid (Both)

```typescript
// Static config for base triggers
export const config = defineQueueConfig({
  flow: {
    triggers: {
      subscribe: ['stripe.payment.succeeded']  // Base trigger
    }
  }
})

// + Dynamic subscription in plugin
export default defineNitroPlugin(() => {
  const { subscribeTrigger } = useTriggers()
  
  // Add conditional triggers at runtime
  if (process.env.FEATURE_TEST_MODE) {
    subscribeTrigger({
      trigger: 'test.payment',
      flow: 'payment-flow'
    })
  }
})
```

✅ **Best of both**: Static base + dynamic extensions

### Properties

- ✅ Registered globally (trigger registry)
- ✅ Reusable across multiple flows
- ✅ Survives server restarts
- ✅ Visible in UI/API

### Entry Trigger Types

#### 1.1. Internal Module Events

Modules emit typed events that flows subscribe to:

```typescript
// server/plugins/authModule.ts
export default defineNitroPlugin((nitroApp) => {
  const { registerTrigger, emitTrigger } = useTriggers()
  
  // Register event trigger (static, flow-scoped)
  registerTrigger({
    name: 'user.created',
    type: 'event',
    scope: 'flow',  // Entry trigger
    displayName: 'User Created',
    description: 'Triggered when a new user signs up',
    source: 'auth-module',
    schema: z.object({
      userId: z.string(),
      email: z.string().email(),
      name: z.string(),
      metadata: z.record(z.any()).optional()
    }),
    config: {
      persistData: true,
      retentionDays: 90
    },
    // OPTIONAL: Expected subscribers (validation/documentation only)
    // Trigger doesn't enforce this - flows subscribe independently
    // Useful for validation warnings if expected flows not found
    expectedSubscribers: [
      'onboarding-flow',
      'notification-flow',
      'analytics-flow'
    ]
  })
  
  // Emit when user is created
  nitroApp.hooks.hook('user:created', async (user) => {
    await emitTrigger('user.created', {
      userId: user.id,
      email: user.email,
      name: user.name,
      metadata: user.metadata
    })
  })
})
```

**Features**:
- Type-safe with Zod schemas
- Module isolation
- Automatic discovery
- Hot reload in dev

#### 1.2. External Webhooks

External services trigger flows via HTTP:

```typescript
// Register webhook trigger (static, flow-scoped)
registerTrigger({
  name: 'stripe.payment.succeeded',
  type: 'webhook',
  scope: 'flow',  // Entry trigger
  displayName: 'Stripe Payment Succeeded',
  source: 'external',
  endpoint: {
    path: '/webhooks/stripe',
    method: 'POST',
    auth: {
      type: 'signature',
      secret: process.env.STRIPE_WEBHOOK_SECRET,
      header: 'stripe-signature',
      verify: stripeVerifySignature
    }
  },
  schema: z.object({
    type: z.literal('payment_intent.succeeded'),
    data: z.object({
      object: z.object({
        id: z.string(),
        amount: z.number(),
        currency: z.string()
      })
    })
  }),
  // Note: transform function can be used here because trigger registration
  // is programmatic (not config-based). Only flow configs are AST-parsed.
  transform: (payload) => ({
    paymentId: payload.data.object.id,
    amount: payload.data.object.amount / 100,
    currency: payload.data.object.currency
  }),
  config: {
    persistData: true,
    retentionDays: 365,
    rateLimit: {
      max: 1000,
      window: 3600000  // Max 1000 per hour
    }
  }
})
```

**Auto-generated endpoint**:
```
POST /api/_triggers/webhooks/stripe
```

**Supported Auth Types**:
- **Signature**: HMAC/SHA verification (Stripe, GitHub, etc.)
- **Bearer Token**: Authorization header
- **API Key**: Custom header or query parameter
- **Basic Auth**: Username/password
- **IP Whitelist**: Source IP filtering
- **Custom**: Provide your own verification function

#### 1.3. Cron Schedules

Time-based triggers:

```typescript
registerTrigger({
  name: 'daily.cleanup',
  type: 'schedule',
  scope: 'flow',  // Entry trigger
  displayName: 'Daily Cleanup',
  schedule: {
    cron: '0 2 * * *',  // 2 AM daily
    timezone: 'America/New_York',
    enabled: true,
    overlap: 'skip'  // skip, queue, or replace
  },
  data: {
    type: 'cleanup',
    retentionDays: 30
  },
  config: {
    persistData: true,
    retentionDays: 90
  }
})
```

**Cron Examples**:
```typescript
'*/5 * * * *'    // Every 5 minutes
'30 * * * *'     // Every hour at :30
'0 12 * * *'     // Every day at noon
'0 9 * * 1'      // Every Monday at 9 AM
'0 0 1 * *'      // First day of month
'0 8 * * 1-5'    // Weekdays at 8 AM
```

**Human-Readable Alternative**:
```typescript
schedule: {
  interval: '1h',  // 1m, 5m, 1h, 1d, 1w
  // OR
  at: '02:00',     // Daily at 2 AM
  // OR
  every: { hours: 6 }  // Every 6 hours
}
```

#### 1.4. Manual Triggers

User-initiated via UI or API:

```typescript
registerTrigger({
  name: 'manual.data.import',
  type: 'manual',
  scope: 'flow',  // Entry trigger
  displayName: 'Import Data',
  description: 'Manually import data from external source',
  source: 'admin',
  schema: z.object({
    source: z.enum(['csv', 'api', 'database']),
    options: z.record(z.any())
  }),
  ui: {
    icon: 'upload',
    color: 'blue',
    form: [
      {
        name: 'source',
        type: 'select',
        label: 'Data Source',
        options: [
          { value: 'csv', label: 'CSV File' },
          { value: 'api', label: 'External API' },
          { value: 'database', label: 'Database' }
        ]
      },
      {
        name: 'options',
        type: 'json',
        label: 'Options (JSON)'
      }
    ]
  }
})
```

**API to trigger**:
```
POST /api/_triggers/manual.data.import/execute
Body: {
  source: 'csv',
  options: { filePath: '/uploads/data.csv' }
}
```

## 2. Subscription Architecture

### 2.1. One-Way Subscription Model

**Design Decision**: Flows subscribe to triggers (not the other way around)

```typescript
// ✅ CORRECT: Flow subscribes to trigger
// Trigger is registered independently
registerTrigger({ name: 'user.created', ... })

// Flow declares subscription in its config
export const config = defineFunctionConfig({
  flow: {
    triggers: { subscribe: ['user.created'] }
  }
})
```

**Why One-Way?**
- ✅ **Loose Coupling** - Triggers don't need to know about flows
- ✅ **Dynamic Subscription** - Add/remove flows without updating triggers
- ✅ **Reusability** - Same trigger works for unlimited flows
- ✅ **Hot Reload** - Change flow subscriptions without touching triggers
- ✅ **Distributed** - Flows can be in different containers

### 2.2. Bidirectional Index (Runtime)

The system automatically builds a bidirectional index for efficient lookups:

```typescript
// Runtime maintains both directions (auto-built)
interface TriggerRuntime {
  // Primary: Trigger → Flows (from flow configs)
  triggerToFlows: Map<string, Set<FlowSubscription>>
  
  // Reverse: Flow → Triggers (from flow configs)
  flowToTriggers: Map<string, Set<string>>
  
  // Trigger registry (from registerTrigger)
  triggers: Map<string, TriggerDefinition>
}

interface FlowSubscription {
  flowName: string
  mode: 'auto' | 'manual'
  filter?: (data: any) => boolean  // Optional programmatic filter
  transform?: (data: any) => any    // Optional programmatic transform
}
```

**Example**:
```typescript
// Trigger fires
await emitTrigger('user.created', { userId: '123' })

// Runtime looks up subscribed flows
const subscribers = runtime.triggerToFlows.get('user.created')
// → ['onboarding-flow', 'notification-flow', 'analytics-flow']

// For each subscriber, trigger flow
for (const sub of subscribers) {
  if (sub.mode === 'auto') {
    await startFlow(sub.flowName, data)
  }
}
```

### 2.3. Optional Bidirectional Hints

Triggers can optionally declare expected subscribers for **validation only**:

```typescript
registerTrigger({
  name: 'user.created',
  // Optional: Expected subscribers (not enforced)
  expectedSubscribers: ['onboarding-flow', 'notification-flow']
})
```

**Validation on startup**:
```typescript
// Runtime checks if expected subscribers exist
const trigger = triggers.get('user.created')
const actualSubscribers = triggerToFlows.get('user.created')

for (const expected of trigger.expectedSubscribers || []) {
  if (!actualSubscribers?.has(expected)) {
    console.warn(
      `[nuxt-queue] Trigger 'user.created' expects subscriber ` +
      `'${expected}' but it's not registered. Check your flow configs.`
    )
  }
}
```

**Benefits**:
- ⚠️ **Validation** - Warn if expected flows missing
- 📖 **Documentation** - Self-documenting trigger usage
- 🔍 **Discovery** - See intended usage in trigger definition
- ❌ **Not Enforced** - Doesn't prevent flows from subscribing/unsubscribing

### 2.4. Programmatic Subscription API

```typescript
// Subscribe to trigger at runtime
interface SubscribeTriggerOptions {
  trigger: string           // Trigger name
  flow: string              // Flow name
  mode?: 'auto' | 'manual'  // Default: 'auto'
  filter?: (data: any) => boolean
  transform?: (data: any) => any
}

const { subscribeTrigger, unsubscribeTrigger } = useTriggers()

// Subscribe
subscribeTrigger({
  trigger: 'stripe.payment.succeeded',
  flow: 'payment-flow',
  mode: 'auto',
  filter: (data) => data.amount > 100  // Only large payments
})

// Unsubscribe
unsubscribeTrigger('stripe.payment.succeeded', 'payment-flow')

// Check subscriptions
const flows = getSubscribedFlows('stripe.payment.succeeded')
const triggers = getFlowTriggers('payment-flow')
```

**Use Cases**:
- 🔧 Feature flags (enable/disable flow triggers)
- 🧪 Testing (add test triggers dynamically)
- 🔄 A/B testing (route triggers to different flows)
- 🎯 Dynamic routing (conditional subscriptions)

### 2.5. Hybrid Registration Summary

| Aspect | File-Based Config | Programmatic API |
|--------|------------------|------------------|
| **When** | Server startup (auto-discovery) | Runtime (plugin/API) |
| **Where** | `defineFunctionConfig()` | `subscribeTrigger()` |
| **Flexibility** | Static, file-based | Dynamic, conditional |
| **Hot Reload** | ✅ Yes (dev mode) | ✅ Yes (runtime) |
| **Type Safety** | ✅ Full TypeScript | ✅ Full TypeScript |
| **Discovery** | ✅ Auto (file scan) | ❌ Manual |
| **Best For** | Base configuration | Runtime modifications |

**Recommendation**: Use **file-based config** for stable subscriptions, **programmatic API** for dynamic/conditional behavior.

## 3. Await Patterns (Run-Scoped)

Wait for external signals before or after step execution. Since queue jobs cannot pause mid-execution, await patterns are **declared in config** and handled by the flow engine.

### 3.1. Properties

- ✅ Declared in step configuration
- ✅ Created dynamically per run (ephemeral trigger)
- ✅ Tied to specific flow run (run-scoped)
- ✅ Auto-cleaned up after use
- ✅ Not visible in global trigger list
- ✅ Can wait **before** step execution (`awaitBefore`) or **after** (`awaitAfter`)

### 3.2. Configuration Approach

```typescript
export const config = defineFunctionConfig({
  flow: {
    name: ['approval-flow'],
    role: 'step',
    step: 'process',
    subscribes: ['data.ready'],
    // AWAIT BEFORE: Wait for trigger before step executes
    awaitBefore: {
      type: 'webhook',
      path: '/approval/{runId}',  // {runId} auto-replaced
      timeout: 86400000,  // 24 hours
      schema: z.object({
        approved: z.boolean(),
        comments: z.string().optional()
      })
    },
    // AWAIT AFTER: Wait for trigger after step completes
    awaitAfter: {
      type: 'time',
      delay: 300000  // 5 minutes
    }
  }
})

export default defineFunction(async (input, ctx) => {
  // If awaitBefore configured, input contains trigger data
  const { approved, comments } = ctx.trigger || {}
  
  if (approved === false) {
    throw new Error(`Denied: ${comments}`)
  }
  
  // Normal step logic
  const result = await processData(input)
  
  // If awaitAfter configured, next step won't trigger until trigger fires
  return result
})
```

### 3.3. Await Pattern Examples

#### 3.3.1. Time-based Await (After Step)

Wait a specific duration after step completes before triggering next steps.

```typescript
export const config = defineFunctionConfig({
  queue: { name: 'orders' },
  flow: {
    name: ['order-flow'],
    role: 'step',
    step: 'cool-down',
    subscribes: ['order.created'],
    emits: ['cool-down.complete'],
    // Wait 5 minutes after step completes
    awaitAfter: {
      type: 'time',
      delay: 300000  // 5 minutes in ms
    }
  }
})

export default defineFunction(async (input, ctx) => {
  ctx.logger.log('info', 'Processing order...')
  await processOrder(input)
  
  // Step completes, but next steps won't trigger for 5 minutes
  ctx.flow.emit('cool-down.complete', { orderId: input.orderId })
  return { processed: true }
})
```

**Flow**: Step executes → Completes → **5 min delay** → Next steps triggered

#### 3.3.2. Event-based Await (Before Step)

Wait for external event before step executes.

```typescript
export const config = defineFunctionConfig({
  queue: { name: 'processing' },
  flow: {
    name: ['data-pipeline'],
    role: 'step',
    step: 'process',
    subscribes: ['job.started'],
    emits: ['process.complete'],
    // Wait for external completion event
    awaitBefore: {
      type: 'event',
      event: 'external.job.completed',
      timeout: 3600000,  // 1 hour
      filterKey: 'jobId'  // Matches event.jobId === step.jobId
    }
  }
})

// Lifecycle hook for when await is registered
export const onAwaitRegister = async (webhookUrl: string, stepData: any, ctx: any) => {
  // Trigger external job when await is set up
  await triggerExternalJob(stepData.jobId)
}

export default defineFunction(async (input, ctx) => {
  // Step executes after external.job.completed event received
  // Event data available in ctx.trigger
  const externalResult = ctx.trigger
  
  return { 
    status: 'completed', 
    result: externalResult 
  }
})
```

**Flow**: Step triggered → **Waits for event** → Event fires → Step executes

#### 3.3.3. Webhook-based Await (Human Approval Before Step)

Wait for webhook approval before executing step.

```typescript
export const config = defineFunctionConfig({
  queue: { name: 'approvals' },
  flow: {
    name: ['approval-flow'],
    role: 'step',
    step: 'execute-approved',
    subscribes: ['review.submitted'],
    emits: ['execution.complete'],
    // Wait for approval webhook before executing
    awaitBefore: {
      type: 'webhook',
      path: '/approval/{runId}/{stepId}',  // Variables auto-replaced
      method: 'POST',
      timeout: 86400000,  // 24 hours
      schema: z.object({
        approved: z.boolean(),
        approver: z.string(),
        comments: z.string().optional()
      })
    }
  }
})

export default defineFunction(async (input, ctx) => {
  // Webhook payload available in ctx.trigger
  const { approved, approver, comments } = ctx.trigger
  
  if (!approved) {
    throw new Error(`Denied by ${approver}: ${comments}`)
  }
  
  // Execute approved action
  await executeApprovedAction(input)
  
  ctx.flow.emit('execution.complete', { 
    approved: true, 
    by: approver 
  })
  
  return { approved: true, by: approver }
})
```

**Flow**: Step triggered → Email sent → **Waits for webhook** → User clicks approve → Step executes

#### 3.3.4. Schedule-based Await (After Step)

Wait until specific time after step completes.

```typescript
export const config = defineFunctionConfig({
  queue: { name: 'reports' },
  flow: {
    name: ['daily-report'],
    role: 'step',
    step: 'generate',
    subscribes: ['data.collected'],
    emits: ['report.ready'],
    // Wait until 9 AM next day before triggering next steps
    awaitAfter: {
      type: 'schedule',
      cron: '0 9 * * *',  // 9 AM daily
      timezone: 'America/New_York',
      nextAfterHours: 24  // Calculate next occurrence after completion + 24 hours
    }
  }
})

export default defineFunction(async (input, ctx) => {
  // Generate report
  const report = await generateReport(input)
  
  // Save report
  await ctx.state.set('report', report)
  
  // Step completes, but won't trigger next steps until 9 AM tomorrow
  ctx.flow.emit('report.ready', { reportId: report.id })
  
  return { generated: true }
})
```

**Flow**: Step executes → Completes → **Waits until 9 AM** → Next steps triggered

### 3.4. Combined Example - Approval Flow

This example shows entry triggers, await patterns, and step chaining working together.

```typescript
// 1. ENTRY TRIGGER: Register global trigger (in plugin)
// server/plugins/formTriggers.ts
export default defineNitroPlugin((nitroApp) => {
  const { registerTrigger, emitTrigger } = useTriggers()
  
  registerTrigger({
    name: 'form.submitted',
    type: 'event',
    scope: 'flow',
    displayName: 'Form Submitted',
    source: 'form-module',
    schema: z.object({
      formId: z.string(),
      reviewerEmail: z.string().email(),
      data: z.record(z.any())
    })
  })
  
  // Emit trigger when form submitted
  nitroApp.hooks.hook('form:submitted', async (form) => {
    await emitTrigger('form.submitted', {
      formId: form.id,
      reviewerEmail: form.reviewer,
      data: form.data
    })
  })
})

// 2. FLOW ENTRY: Start flow from trigger
// server/functions/approval-flow/start.ts
export const config = defineFunctionConfig({
  queue: { name: 'approvals' },
  flow: {
    name: ['approval-flow'],
    role: 'entry',
    step: 'start',
    // Subscribe to form.submitted trigger
    triggers: {
      subscribe: ['form.submitted'],
      mode: 'auto'
    },
    emits: ['approval.requested']
  }
})

export default defineFunction(async (input, ctx) => {
  const { formId, reviewerEmail, data } = input
  
  // Store form data
  await ctx.state.set('formData', data)
  
  // Trigger approval step
  ctx.flow.emit('approval.requested', { 
    formId, 
    reviewerEmail 
  })
  
  return { requested: true }
})

// 3. AWAIT PATTERN: Wait for approval before processing
// server/functions/approval-flow/approve.ts
export const config = defineFunctionConfig({
  queue: { name: 'approvals' },
  flow: {
    name: ['approval-flow'],
    role: 'step',
    step: 'approve',
    subscribes: ['approval.requested'],
    emits: ['approval.received'],
    // AWAIT BEFORE: Wait for approval webhook
    awaitBefore: {
      type: 'webhook',
      path: '/forms/{runId}/approve',
      timeout: 86400000,  // 24 hours
      schema: z.object({
        approved: z.boolean(),
        comments: z.string().optional()
      })
    }
  }
})

// Lifecycle hook: Called when await trigger is registered
export const onAwaitRegister = async (webhookUrl: string, stepData: any, ctx: any) => {
  // Send email with approval link when webhook is set up
  await sendApprovalEmail({
    to: stepData.reviewerEmail,
    formId: stepData.formId,
    approveUrl: `${webhookUrl}?approved=true`,
    denyUrl: `${webhookUrl}?approved=false`
  })
}

export default defineFunction(async (input, ctx) => {
  // Webhook payload in ctx.trigger
  const { approved, comments } = ctx.trigger
  
  // Emit result
  ctx.flow.emit('approval.received', {
    formId: input.formId,
    approved,
    comments
  })
  
  return { approved, comments }
})

// 4. STEP CHAIN: Process based on approval
// server/functions/approval-flow/process.ts
export const config = defineFunctionConfig({
  queue: { name: 'approvals' },
  flow: {
    name: ['approval-flow'],
    role: 'step',
    step: 'process',
    subscribes: ['approval.received']
  }
})

export default defineFunction(async (input, ctx) => {
  const { approved, formId, comments } = input['approval.received']
  
  if (!approved) {
    await notifyRejection(formId, comments)
    return { status: 'rejected', reason: comments }
  }
  
  // Get form data from state
  const formData = await ctx.state.get('formData')
  
  // Process approved form
  await processForm(formId, formData)
  
  return { status: 'approved', formId }
})
```

**Flow**:
1. Form submitted → **Entry Trigger** `form.submitted` fires → Flow starts
2. Entry step emits `approval.requested` → **Step Chain** triggers approve step
3. Approve step registers → **Await Pattern** creates ephemeral webhook trigger
4. Email sent with webhook URL → **User waits**
5. Reviewer clicks approve → Webhook hit → **Await resolves** → Approve step executes
6. Approve step emits `approval.received` → **Step Chain** triggers process step
7. Process step handles approval/rejection

## 4. Relationship to Flow Step Chaining

**Important**: Entry triggers and await patterns are **separate** from flow step chaining!

**Entry Triggers** → Start flows (external → internal)
```typescript
// In flow config
triggers: {
  subscribe: ['stripe.payment.succeeded']  // STARTS flow
}
```

**Await Patterns** → Wait for external signals (before/after step)
```typescript
// In flow config
awaitBefore: {
  type: 'webhook',
  path: '/approval/{runId}'  // WAITS before step executes
}
```

**Flow Step Chaining** → Step → Step coordination (internal)
```typescript
// In worker code
ctx.flow.emit('payment.processed', { orderId: 123 })
// subscribes: ['payment.processed']  // CHAINS to next step
```

**Three independent systems**:
1. **Entry Triggers**: External world → Flow starts
2. **Await Patterns**: Step waits → External signal → Step proceeds  
3. **Step Emits/Subscribes**: Step A done → Step B starts (unchanged!)

### 4.1. Example Combining All Three

```typescript
// Step 1: ENTRY TRIGGER - External event starts flow
// server/functions/order-flow/start.ts
export const config = defineFunctionConfig({
  queue: { name: 'orders' },
  flow: {
    name: ['order-flow'],
    role: 'entry',
    step: 'start',
    // 1. Flow starts from external event
    triggers: {
      subscribe: ['order.placed']
    },
    emits: ['order.validated']
  }
})

export default defineFunction(async (input, ctx) => {
  // Validate order
  await validateOrder(input)
  
  // STEP CHAIN: Trigger payment step
  ctx.flow.emit('order.validated', { 
    orderId: input.orderId,
    amount: input.amount
  })
  
  return { validated: true }
})

// Step 2: AWAIT PATTERN - Wait for payment confirmation
// server/functions/order-flow/payment.ts
export const config = defineFunctionConfig({
  queue: { name: 'orders' },
  flow: {
    name: ['order-flow'],
    role: 'step',
    step: 'payment',
    subscribes: ['order.validated'],
    emits: ['payment.confirmed'],
    // 2. Wait for external payment webhook
    awaitBefore: {
      type: 'webhook',
      path: '/payment/{runId}',
      timeout: 1800000,  // 30 minutes
      schema: z.object({
        orderId: z.string(),
        status: z.enum(['success', 'failed']),
        transactionId: z.string()
      })
    }
  }
})

// Lifecycle hook: Called when await is registered
export const onAwaitRegister = async (webhookUrl: string, stepData: any, ctx: any) => {
  // Initiate payment with callback URL when webhook is set up
  await initiatePayment({
    orderId: stepData.orderId,
    amount: stepData.amount,
    callbackUrl: webhookUrl
  })
}

export default defineFunction(async (input, ctx) => {
  // Webhook payload in ctx.trigger
  const { orderId, status, transactionId } = ctx.trigger
  
  if (status !== 'success') {
    throw new Error('Payment failed')
  }
  
  // STEP CHAIN: Continue to fulfillment
  ctx.flow.emit('payment.confirmed', {
    orderId,
    transactionId
  })
  
  return { paid: true, transactionId }
})

// Step 3: Regular step (no await)
// server/functions/order-flow/fulfill.ts
export const config = defineFunctionConfig({
  queue: { name: 'orders' },
  flow: {
    name: ['order-flow'],
    role: 'step',
    step: 'fulfill',
    subscribes: ['payment.confirmed']
  }
})

export default defineFunction(async (input, ctx) => {
  const { orderId, transactionId } = input['payment.confirmed']
  
  // Fulfill order
  await fulfillOrder(orderId)
  
  return { fulfilled: true }
})
```

**Clear boundaries**:
- **Entry**: How flow **starts** (external → internal) - `triggers.subscribe`
- **Await**: How step **waits** (external signal) - `awaitBefore`/`awaitAfter`
- **Chain**: How steps **connect** (step → step) - `ctx.flow.emit()` + `subscribes`

**Flow execution**:
1. External `order.placed` event → Entry trigger → Flow starts
2. Start step validates → Emits `order.validated` → Payment step triggered
3. Payment step awaits webhook → Payment gateway called
4. Payment webhook received → Payment step executes → Emits `payment.confirmed`
5. Fulfill step triggered → Order fulfilled

## How Await Patterns Work

### The Problem with Programmatic Await

Queue systems like BullMQ and FastQ process jobs to completion - they **cannot pause mid-execution**. This means:

```typescript
// ❌ THIS DOESN'T WORK with queue systems
export default defineFunction(async (input, ctx) => {
  await processStep1()
  
  // Cannot pause here and wait for webhook
  await ctx.await.webhook({ path: '/approval' })  // ❌ Job would block
  
  await processStep2()
})
```

The job would tie up a worker slot while waiting, and there's no way to serialize the execution state to resume later.

### The Config-Based Solution

Instead, await patterns are **declared in config** and managed by the flow engine:

```typescript
export const config = defineFunctionConfig({
  flow: {
    // ...
    awaitBefore: {  // Wait BEFORE step executes
      type: 'webhook',
      path: '/approval/{runId}'
    }
  }
})

export default defineFunction(async (input, ctx) => {
  // Step executes AFTER webhook received
  // Trigger data available in ctx.trigger
  const { approved } = ctx.trigger
  
  if (!approved) {
    throw new Error('Not approved')
  }
  
  await processApprovedData(input)
})
```

### Execution Flow

#### With `awaitBefore`

```
1. Previous step emits event
2. Flow engine checks if step has awaitBefore
3. IF YES:
   a. Create ephemeral trigger (webhook, event, etc.)
   b. Register trigger in registry
   c. DO NOT enqueue job yet
   d. Wait for trigger to fire
4. Trigger fires (webhook hit, event emitted, etc.)
5. Flow engine receives trigger
6. Enqueue job with trigger data
7. Worker executes with ctx.trigger populated
8. Step completes, cleanup trigger
```

#### With `awaitAfter`

```
1. Previous step emits event
2. Flow engine enqueues job normally
3. Worker executes step
4. Step completes, returns result
5. Flow engine checks if step has awaitAfter
6. IF YES:
   a. Create ephemeral trigger
   b. Register trigger in registry
   c. DO NOT trigger next steps yet
   d. Wait for trigger to fire
7. Trigger fires
8. Flow engine triggers subscribed steps
9. Cleanup trigger
```

### State Machine View

```
┌─────────────────────────────────────────────────────┐
│              Step with awaitBefore                  │
│                                                     │
│  [Step Ready] ──→ [Trigger Registered]             │
│                          │                          │
│                          ↓                          │
│                   [Waiting for                      │
│                    External Signal]                 │
│                          │                          │
│                          ↓                          │
│              [Trigger Fires] ──→ [Job Enqueued]    │
│                                        │            │
│                                        ↓            │
│                                 [Step Executes]     │
│                                        │            │
│                                        ↓            │
│                                  [Completes]        │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│              Step with awaitAfter                   │
│                                                     │
│  [Step Ready] ──→ [Job Enqueued]                   │
│                          │                          │
│                          ↓                          │
│                   [Step Executes]                   │
│                          │                          │
│                          ↓                          │
│                   [Completes] ──→ [Trigger          │
│                                    Registered]      │
│                                        │            │
│                                        ↓            │
│                                 [Waiting for        │
│                                  External Signal]   │
│                                        │            │
│                                        ↓            │
│                                 [Trigger Fires]     │
│                                        │            │
│                                        ↓            │
│                              [Next Steps Triggered] │
└─────────────────────────────────────────────────────┘
```

### Storage During Await

While waiting, state is stored in Redis:

```
# Ephemeral trigger registration
nq:triggers:registry → Hash
  "await:run-abc-123:approve": "{
    type: 'webhook',
    scope: 'run',
    runId: 'run-abc-123',
    stepId: 'approve',
    ephemeral: true,
    ...
  }"

# Webhook route mapping
nq:webhook:routes → Hash
  "/approval/run-abc-123": "await:run-abc-123:approve"

# Step state (what we're waiting for)
nq:flow:run-abc-123:await → Hash
  "approve": "{
    status: 'waiting',
    registeredAt: '2025-11-19T10:00:00Z',
    timeout: 86400000,
    nextSteps: ['process', 'notify']
  }"
```

### Timeout Handling

Awaits can timeout:

```typescript
awaitBefore: {
  type: 'webhook',
  path: '/approval/{runId}',
  timeout: 86400000,  // 24 hours
  onTimeout: 'fail'  // or 'continue' or 'retry'
}
```

If timeout expires:
- Trigger cleaned up
- Step marked as failed/skipped based on `onTimeout`
- Next steps triggered (if `onTimeout: 'continue'`) or flow ends

## Implementation

See [Implementation Details](./trigger-system-implementation.md) for:
- Unified storage architecture
- Trigger registry implementation
- Webhook handler
- Await state machine implementation
- Event types and API endpoints
- Storage optimization details

## Configuration Types

### Lifecycle Hooks

Since configuration is parsed via AST (Abstract Syntax Tree), **functions cannot be included in config**. Instead, lifecycle hooks are exported separately from the worker file:

```typescript
// server/functions/approval-flow/approve.ts
export const config = defineFunctionConfig({
  flow: {
    awaitBefore: {
      type: 'webhook',
      path: '/approval/{runId}'  // ✅ Simple values only
      // ❌ Cannot use: onRegister: async () => { ... }
    }
  }
})

// ✅ Export lifecycle hooks separately
export const onAwaitRegister = async (webhookUrl: string, stepData: any, ctx: any) => {
  // Called when await trigger is registered
  await sendEmail({ url: webhookUrl })
}

export const onAwaitResolve = async (triggerData: any, stepData: any, ctx: any) => {
  // Called when trigger fires and resolves
  await logApproval(triggerData)
}

export const onAwaitTimeout = async (stepData: any, ctx: any) => {
  // Called when await times out
  await notifyTimeout(stepData)
}

export default defineFunction(async (input, ctx) => {
  // Worker logic
})
```

**Available Lifecycle Hooks**:
- `onAwaitRegister`: Called when ephemeral trigger is created
- `onAwaitResolve`: Called when trigger fires successfully
- `onAwaitTimeout`: Called when await times out

### Await Configuration

```typescript
// Await configuration (in flow config)
interface AwaitConfig {
  // Trigger type
  type: 'webhook' | 'event' | 'schedule' | 'time'
  
  // Type-specific configuration
  // For webhook
  path?: string  // URL path, supports {runId}, {stepId} variables
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  schema?: z.ZodSchema  // Validate webhook payload
  
  // For event
  event?: string  // Event name to wait for
  filterKey?: string  // Key to match between event and step data
                      // e.g., 'jobId' matches event.jobId === stepData.jobId
                      // Supports nested: 'order.id' matches event.order.id === stepData.order.id
  
  // For schedule
  cron?: string  // Cron expression
  nextAfterHours?: number  // Hours to add after completion (alternative to cron)
  
  // For time
  delay?: number  // Milliseconds to wait
  
  // Common options
  timeout?: number  // Max wait time in ms
  timeoutAction?: 'fail' | 'continue' | 'retry'  // What to do on timeout
  
  // Lifecycle hooks (defined separately, not in config)
  // Use onAwaitRegister, onAwaitResolve, onAwaitTimeout exports
}

// Flow config with await
interface FlowConfig {
  name: string | string[]
  role: 'entry' | 'step'
  step: string
  subscribes?: string | string[]
  emits?: string[]
  
  // Entry triggers (flow-scoped)
  triggers?: {
    subscribe: string[]
    mode: 'auto' | 'manual'  // Cannot be a function (config parsed via AST)
  }
  
  // Await patterns (run-scoped)
  awaitBefore?: AwaitConfig  // Wait before step executes
  awaitAfter?: AwaitConfig   // Wait after step completes
}
```

### Worker Context

```typescript
interface WorkerContext {
  // Existing context
  jobId: string
  queue: string
  flowId: string
  flowName: string
  stepName: string
  stepId: string
  attempt: number
  logger: Logger
  state: StateManager
  flow: FlowEngine
  
  // NEW: Trigger data from await
  trigger?: any  // Populated if awaitBefore configured and trigger fired
  
  // Trigger metadata
  triggerMetadata?: {
    type: 'webhook' | 'event' | 'schedule' | 'time'
    firedAt: string
    source: string
  }
}
```

## Migration from v0.4

### Scheduling Migration

**v0.4 (Current)**:
```typescript
// Schedule via API
POST /api/_flows/cleanup-flow/schedule
{
  cron: '0 2 * * *',
  input: { days: 30 }
}
```

**v0.5 (New)**:
```typescript
// Register schedule trigger
registerTrigger({
  name: 'daily.cleanup',
  type: 'schedule',
  scope: 'flow',
  schedule: {
    cron: '0 2 * * *'
  },
  data: { days: 30 }
})

// Flow subscribes to trigger
export const config = defineFunctionConfig({
  flow: {
    role: 'entry',
    triggers: {
      subscribe: ['daily.cleanup'],
      mode: 'auto'
    }
  }
})
```

### No Breaking Changes

The v0.5 trigger system is **additive**:
- ✅ Existing flows continue to work
- ✅ `ctx.flow.emit()` and `subscribes` unchanged
- ✅ v0.4 scheduling API remains functional (internally uses triggers)
- ✅ New trigger features opt-in

**Migration timeline**:
- v0.5.0: Trigger system available alongside v0.4 patterns
- v0.6.0: Deprecation warnings for v0.4 scheduling API
- v0.7.0: Remove v0.4 scheduling API (migration tool provided)

## Benefits

✅ **Queue-Compatible**: Works with BullMQ, FastQ, and any job queue system  
✅ **Config-Based**: Await patterns declared in config, not code  
✅ **Clear Separation**: Entry triggers vs await patterns vs step chaining  
✅ **Shared Infrastructure**: Same webhook/event system for all triggers  
✅ **Flexible Positioning**: Wait before OR after step execution  
✅ **Type-Safe**: Full TypeScript support with Zod validation  
✅ **No Worker Blocking**: Jobs complete immediately, no waiting workers  
✅ **State Preserved**: Full run context maintained during waits  
✅ **Auto-Cleanup**: Ephemeral triggers expire automatically  
✅ **Minimal Storage**: Optimized Redis usage  
✅ **Timeout Support**: Configurable timeouts with fallback behavior  
✅ **Observable**: Full visibility into waiting steps via UI/API  
✅ **Backward Compatible**: v0.4 patterns continue to work  
✅ **Hybrid Registration**: File-based config + programmatic API  
✅ **Runtime Flexibility**: Change subscriptions on the fly  
✅ **Loose Coupling**: One-way subscription model (flows → triggers)  
✅ **Distributed Ready**: Event-based registry like v0.8 architecture

## Implementation Details

### Hybrid Registration Implementation

The trigger system supports **both** file-based configuration (auto-discovery) and programmatic API (runtime registration).

#### Runtime Plugin: Auto-Discovery

```typescript
// src/runtime/server/plugins/triggerAutoDiscovery.ts
import { useRegistry } from '#nuxt-queue/registry'
import { useTriggers } from '#nuxt-queue/triggers'

export default defineNitroPlugin((nitro) => {
  const registry = useRegistry()
  const { subscribeTrigger, registerTrigger } = useTriggers()
  
  console.log('[nuxt-queue] Auto-discovering trigger subscriptions...')
  
  // Scan all workers for trigger subscriptions
  let subscriptionCount = 0
  for (const worker of registry.workers) {
    if (!worker.flow?.triggers?.subscribe) continue
    
    const flowName = Array.isArray(worker.flow.names) 
      ? worker.flow.names[0] 
      : worker.flow.names
    
    // Register each subscription
    for (const triggerName of worker.flow.triggers.subscribe) {
      subscribeTrigger({
        trigger: triggerName,
        flow: flowName,
        mode: worker.flow.triggers.mode || 'auto'
      })
      subscriptionCount++
    }
  }
  
  console.log(
    `[nuxt-queue] Auto-discovered ${subscriptionCount} trigger subscriptions ` +
    `from ${registry.workers.length} workers`
  )
})
```

#### Runtime State: Bidirectional Index

```typescript
// src/runtime/server/utils/triggerRuntime.ts

export interface TriggerRuntime {
  // Trigger registry (from registerTrigger)
  triggers: Map<string, TriggerDefinition>
  
  // Subscriptions: Trigger → Flows (from flow configs + programmatic)
  triggerToFlows: Map<string, Set<FlowSubscription>>
  
  // Reverse index: Flow → Triggers (auto-built)
  flowToTriggers: Map<string, Set<string>>
  
  // Await triggers (ephemeral, run-scoped)
  awaitTriggers: Map<string, AwaitTriggerDefinition>
}

export interface FlowSubscription {
  flowName: string
  mode: 'auto' | 'manual'
  filter?: (data: any) => boolean
  transform?: (data: any) => any
  // Metadata
  source: 'config' | 'programmatic'  // How was it registered?
  registeredAt: string
}

// Global runtime state
let runtime: TriggerRuntime

export function getTriggerRuntime(): TriggerRuntime {
  if (!runtime) {
    runtime = {
      triggers: new Map(),
      triggerToFlows: new Map(),
      flowToTriggers: new Map(),
      awaitTriggers: new Map()
    }
  }
  return runtime
}
```

#### Composable: useTriggers

```typescript
// src/runtime/server/composables/useTriggers.ts

export function useTriggers() {
  const runtime = getTriggerRuntime()
  
  return {
    // Register trigger
    registerTrigger(def: TriggerDefinition) {
      runtime.triggers.set(def.name, def)
      
      // Validate expected subscribers if provided
      if (def.expectedSubscribers) {
        const actualSubs = runtime.triggerToFlows.get(def.name)
        for (const expected of def.expectedSubscribers) {
          const found = Array.from(actualSubs || []).some(
            sub => sub.flowName === expected
          )
          if (!found) {
            console.warn(
              `[nuxt-queue] Trigger '${def.name}' expects subscriber ` +
              `'${expected}' but it's not registered`
            )
          }
        }
      }
      
      console.log(`[nuxt-queue] Registered trigger: ${def.name}`)
    },
    
    // Subscribe flow to trigger (programmatic)
    subscribeTrigger(opts: SubscribeTriggerOptions) {
      const { trigger, flow, mode = 'auto', filter, transform } = opts
      
      // Add to trigger → flows index
      if (!runtime.triggerToFlows.has(trigger)) {
        runtime.triggerToFlows.set(trigger, new Set())
      }
      runtime.triggerToFlows.get(trigger)!.add({
        flowName: flow,
        mode,
        filter,
        transform,
        source: 'programmatic',
        registeredAt: new Date().toISOString()
      })
      
      // Add to flow → triggers reverse index
      if (!runtime.flowToTriggers.has(flow)) {
        runtime.flowToTriggers.set(flow, new Set())
      }
      runtime.flowToTriggers.get(flow)!.add(trigger)
      
      console.log(`[nuxt-queue] Subscribed flow '${flow}' to trigger '${trigger}'`)
    },
    
    // Unsubscribe flow from trigger
    unsubscribeTrigger(trigger: string, flow: string) {
      const subs = runtime.triggerToFlows.get(trigger)
      if (subs) {
        for (const sub of subs) {
          if (sub.flowName === flow) {
            subs.delete(sub)
          }
        }
      }
      
      const triggers = runtime.flowToTriggers.get(flow)
      if (triggers) {
        triggers.delete(trigger)
      }
      
      console.log(`[nuxt-queue] Unsubscribed flow '${flow}' from trigger '${trigger}'`)
    },
    
    // Emit trigger
    async emitTrigger(name: string, data: any) {
      const trigger = runtime.triggers.get(name)
      if (!trigger) {
        throw new Error(`[nuxt-queue] Trigger '${name}' not registered`)
      }
      
      // Validate schema
      if (trigger.schema) {
        const result = trigger.schema.safeParse(data)
        if (!result.success) {
          throw new Error(
            `[nuxt-queue] Trigger '${name}' data validation failed: ` +
            result.error.message
          )
        }
      }
      
      // Get subscribed flows
      const subscribers = runtime.triggerToFlows.get(name) || new Set()
      
      console.log(
        `[nuxt-queue] Trigger '${name}' fired with ${subscribers.size} subscribers`
      )
      
      // Trigger each subscribed flow
      for (const sub of subscribers) {
        if (sub.mode !== 'auto') {
          console.log(`[nuxt-queue] Skipping manual flow: ${sub.flowName}`)
          continue
        }
        
        // Apply filter if provided
        if (sub.filter && !sub.filter(data)) {
          console.log(`[nuxt-queue] Flow '${sub.flowName}' filtered out`)
          continue
        }
        
        // Apply transform if provided
        const transformedData = sub.transform ? sub.transform(data) : data
        
        // Start flow
        await startFlow(sub.flowName, transformedData)
      }
    },
    
    // Query methods
    getSubscribedFlows(trigger: string): string[] {
      const subs = runtime.triggerToFlows.get(trigger) || new Set()
      return Array.from(subs).map(s => s.flowName)
    },
    
    getFlowTriggers(flow: string): string[] {
      return Array.from(runtime.flowToTriggers.get(flow) || new Set())
    },
    
    getTrigger(name: string): TriggerDefinition | undefined {
      return runtime.triggers.get(name)
    },
    
    getAllTriggers(): TriggerDefinition[] {
      return Array.from(runtime.triggers.values())
    }
  }
}
```

#### Event Store Integration (v0.8 Pattern)

For distributed deployments, trigger subscriptions are also emitted to the event store:

```typescript
// src/runtime/server/plugins/triggerEventEmission.ts

export default defineNitroPlugin(async (nitro) => {
  const { getAllTriggers, getSubscribedFlows } = useTriggers()
  const eventManager = getEventManager()
  const instanceId = useRuntimeConfig().queue.instanceId || hostname()
  
  // Emit all trigger subscriptions to event store
  for (const trigger of getAllTriggers()) {
    const flows = getSubscribedFlows(trigger.name)
    
    await eventManager.emit('trigger.subscription.registered', {
      instanceId,
      triggerName: trigger.name,
      triggerType: trigger.type,
      subscribedFlows: flows,
      timestamp: new Date().toISOString()
    })
  }
  
  console.log(
    `[nuxt-queue] Emitted trigger subscriptions to event store ` +
    `for instance: ${instanceId}`
  )
})
```

This enables distributed instances to discover which triggers are available and which flows subscribe to them.

### Subscription Validation

Validate trigger subscriptions on startup:

```typescript
// src/runtime/server/plugins/validateTriggers.ts

export default defineNitroPlugin((nitro) => {
  const { getAllTriggers, getSubscribedFlows } = useTriggers()
  
  for (const trigger of getAllTriggers()) {
    // Check if any flows subscribe
    const subscribers = getSubscribedFlows(trigger.name)
    
    if (subscribers.length === 0) {
      console.warn(
        `[nuxt-queue] Trigger '${trigger.name}' has no subscribers`
      )
    }
    
    // Check expected subscribers
    if (trigger.expectedSubscribers) {
      for (const expected of trigger.expectedSubscribers) {
        if (!subscribers.includes(expected)) {
          console.warn(
            `[nuxt-queue] Trigger '${trigger.name}' expects subscriber ` +
            `'${expected}' but it's not registered`
          )
        }
      }
      
      // Check for unexpected subscribers
      for (const actual of subscribers) {
        if (!trigger.expectedSubscribers.includes(actual)) {
          console.info(
            `[nuxt-queue] Flow '${actual}' subscribes to trigger ` +
            `'${trigger.name}' but it's not in expectedSubscribers`
          )
        }
      }
    }
  }
})

## Quick Reference

### Register Trigger (Programmatic)

```typescript
// In server plugin
const { registerTrigger } = useTriggers()

registerTrigger({
  name: 'user.created',
  type: 'event',
  scope: 'flow',
  displayName: 'User Created',
  source: 'auth-module',
  schema: z.object({
    userId: z.string(),
    email: z.string().email()
  })
})
```

### Emit Trigger (Programmatic)

```typescript
// In server code
const { emitTrigger } = useTriggers()

await emitTrigger('user.created', {
  userId: '123',
  email: 'user@example.com'
})
```

### Subscribe to Trigger (Config)

```typescript
// In worker config
export const config = defineFunctionConfig({
  flow: {
    role: 'entry',
    step: 'onboard',
    triggers: {
      subscribe: ['user.created'],
      mode: 'auto'
    }
  }
})
```

### Await Before Step (Config)

```typescript
// In worker config
export const config = defineFunctionConfig({
  flow: {
    role: 'step',
    step: 'process',
    awaitBefore: {
      type: 'webhook',
      path: '/approval/{runId}',
      timeout: 86400000,
      schema: z.object({
        approved: z.boolean()
      })
    }
  }
})

// In worker code
export default defineFunction(async (input, ctx) => {
  // Access trigger data
  const { approved } = ctx.trigger
  
  if (!approved) {
    throw new Error('Not approved')
  }
  
  return { processed: true }
})
```

### Await After Step (Config)

```typescript
// In worker config
export const config = defineFunctionConfig({
  flow: {
    role: 'step',
    step: 'generate',
    emits: ['report.ready'],
    awaitAfter: {
      type: 'time',
      delay: 300000  // 5 minutes
    }
  }
})

// In worker code
export default defineFunction(async (input, ctx) => {
  const report = await generateReport(input)
  
  // Step completes, but next steps wait 5 minutes
  ctx.flow.emit('report.ready', { reportId: report.id })
  
  return report
})
```

### Common Patterns

```typescript
// Entry + Await Before + Step Chain
export const config = defineFunctionConfig({
  flow: {
    name: ['approval-flow'],
    role: 'step',
    step: 'approve',
    subscribes: ['review.submitted'],  // Step chain
    emits: ['approval.received'],
    awaitBefore: {                     // Await webhook
      type: 'webhook',
      path: '/approval/{runId}'
    }
  }
})

// Time-based delay after step
awaitAfter: {
  type: 'time',
  delay: 300000  // 5 minutes
}

// Schedule-based (wait until specific time)
awaitAfter: {
  type: 'schedule',
  cron: '0 9 * * *',  // 9 AM daily
  nextAfterHours: 24  // Wait until next occurrence at least 24h after completion
}

// Event-based with filter
awaitBefore: {
  type: 'event',
  event: 'external.completed',
  filterKey: 'id',  // Matches event.id === step.id
  timeout: 3600000
}
```
