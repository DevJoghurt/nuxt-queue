# Universal Trigger System - Events, Webhooks, Schedules & Await Patterns

> **Version**: v0.5.0  
> **Status**: 📋 Planning  
> **Last Updated**: 2025-11-03  
> **Migration Note**: ⚠️ This will replace the simple v0.4 scheduling implementation (see [v0.4 Flow Scheduling](../v0.4/flow-scheduling.md))

## Goal

Build a comprehensive trigger system that unifies ALL ways flows interact with external events - whether starting a flow or resuming a paused step.

This replaces the temporary v0.4 scheduling solution with a complete trigger infrastructure supporting events, webhooks, schedules, and await patterns.

## Core Concept

Triggers serve two purposes:
1. **Entry Triggers** - Start new flow runs (flow entry points)
2. **Await Triggers** - Resume paused steps (human-in-the-loop, approvals, delays)

Both use the same trigger infrastructure with different scoping:
- Entry triggers are **flow-scoped** (start any run)
- Await triggers are **run-scoped** (resume specific run)

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

```typescript
// Flow entry configuration
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
```

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
    }
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

## 2. Await Patterns (Run-Scoped)

Pause a step and wait for external trigger to resume.

### Properties

- ✅ Created dynamically (ephemeral trigger)
- ✅ Tied to specific flow run (run-scoped)
- ✅ Auto-cleaned up after use
- ✅ Not visible in global trigger list

### Await Pattern Examples

#### 2.1. Time-based Await

```typescript
export default defineQueueWorker(async (job, ctx) => {
  ctx.logger.log('info', 'Processing order...')
  
  // Pause for 5 minutes (cool-down period)
  await ctx.await.time(300000)
  
  ctx.logger.log('info', 'Resuming after delay')
  return { processed: true }
})
```

#### 2.2. Event-based Await

```typescript
export default defineQueueWorker(async (job, ctx) => {
  // Start external processing
  await triggerExternalJob(job.data)
  
  // Pause until event fires (run-scoped)
  const result = await ctx.await.event({
    type: 'external.completed',
    filter: (event) => event.jobId === job.data.id,
    timeout: 3600000  // 1 hour
  })
  
  return { status: 'completed', result }
})
```

#### 2.3. Webhook-based Await (Human Approval)

```typescript
export default defineQueueWorker(async (job, ctx) => {
  // Send approval request
  await sendApprovalEmail({
    to: job.data.approver,
    requestId: job.data.id,
    // Webhook URL auto-generated
    approveUrl: ctx.await.getWebhookUrl()
  })
  
  // Pause until webhook called (run-scoped, ephemeral)
  const approval = await ctx.await.webhook({
    path: `/approval/${job.data.id}`,
    timeout: 86400000,  // 24 hours
    schema: z.object({
      approved: z.boolean(),
      comments: z.string().optional()
    })
  })
  
  if (!approval.approved) {
    throw new Error(`Denied: ${approval.comments}`)
  }
  
  return { approved: true, by: approval.userId }
})
```

#### 2.4. Schedule-based Await

```typescript
export default defineQueueWorker(async (job, ctx) => {
  // Process now
  const result = await processData(job.data)
  
  // Wait until 9 AM tomorrow to send report
  const tomorrow9am = new Date()
  tomorrow9am.setDate(tomorrow9am.getDate() + 1)
  tomorrow9am.setHours(9, 0, 0, 0)
  
  await ctx.await.until(tomorrow9am)
  
  await sendReport(result)
  return { sent: true }
})
```

### Combined Example - Approval Flow

```typescript
// Entry trigger registration (static, global)
registerTrigger({
  name: 'form.submitted',
  type: 'event',
  source: 'form-module'
})

// Flow entry point
export const config = defineQueueConfig({
  flow: {
    names: ['approval-flow'],
    role: 'entry',
    step: 'review',
    // Entry: How flow starts
    triggers: {
      subscribe: ['form.submitted'],
      mode: 'auto'
    }
  }
})

export default defineQueueWorker(async (job, ctx) => {
  const form = job.data
  
  // Send to reviewer
  await sendReviewRequest(form.reviewerEmail, form.id)
  
  // Await: Pause for approval (run-scoped, ephemeral)
  const approval = await ctx.await.webhook({
    path: `/forms/${form.id}/approve`,
    timeout: 86400000,  // 24 hours
    schema: z.object({
      approved: z.boolean(),
      comments: z.string()
    })
  })
  
  if (approval.approved) {
    await processForm(form)
    return { status: 'approved' }
  } else {
    return { status: 'rejected', reason: approval.comments }
  }
})
```

**Flow**:
1. Form submitted → **Entry Trigger** fires → Flow starts
2. Worker requests approval → **Await Pattern** creates ephemeral trigger
3. Reviewer clicks approve → Webhook hit → **Await resumes** → Flow continues

## 3. Relationship to Flow Step Chaining

**Important**: Entry triggers and await patterns are **separate** from flow step chaining!

**Entry Triggers** → Start flows (external → internal)
```typescript
triggers: {
  subscribe: ['stripe.payment.succeeded']  // STARTS flow
}
```

**Await Patterns** → Pause/resume steps (within run)
```typescript
await ctx.await.webhook({ path: '/approval' })  // PAUSES step
```

**Flow Step Chaining** → Step → Step coordination (internal)
```typescript
ctx.emit({ type: 'emit', data: { name: 'payment.processed' } })
// subscribes: ['payment.processed']  // CHAINS to next step
```

**Three independent systems**:
1. **Entry Triggers**: External world → Flow starts
2. **Await Patterns**: Step pauses → External signal → Step resumes  
3. **Step Emits/Subscribes**: Step A done → Step B starts (unchanged!)

### Example Combining All Three

```typescript
// ENTRY TRIGGER: External event starts flow
export const config = defineQueueConfig({
  flow: {
    role: 'entry',
    triggers: {
      subscribe: ['order.placed']  // 1. Flow starts from external event
    }
  }
})

export default defineQueueWorker(async (job, ctx) => {
  // Process order
  await processOrder(job.data)
  
  // AWAIT PATTERN: Pause for external confirmation
  const payment = await ctx.await.webhook({
    path: `/payment/${job.data.orderId}`  // 2. Step pauses, waits for webhook
  })
  
  // STEP CHAIN: Continue to next step
  ctx.emit({ 
    type: 'emit', 
    data: { 
      name: 'order.paid',  // 3. Next step starts via emit/subscribe
      orderId: job.data.orderId 
    }
  })
  
  return { paid: true }
})
```

**Clear boundaries**:
- **Entry**: How flow **starts** (external → internal)
- **Await**: How step **waits** (pause → resume)
- **Chain**: How steps **connect** (step → step)

## Implementation

See [Implementation Details](./trigger-system-implementation.md) for:
- Unified storage architecture
- Trigger registry implementation
- Webhook handler
- Event types and API endpoints
- Storage optimization details

## Benefits

✅ **Clear Separation**: Different config locations, no confusion  
✅ **Shared Infrastructure**: Same webhook/event system  
✅ **Consistent API**: Both use trigger primitives  
✅ **Simpler Mental Model**: Entry = start, Await = pause/resume  
✅ **No Naming Conflicts**: `triggers` vs `ctx.await.*`  
✅ **Flexible**: Mix entry triggers with await patterns in same flow  
✅ **Minimal Storage**: Optimized Redis usage  
✅ **Auto-Cleanup**: Ephemeral triggers expire automatically
