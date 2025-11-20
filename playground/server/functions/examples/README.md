# Trigger & Await Pattern Examples

This directory contains practical examples demonstrating the trigger system and await patterns in nvent.

## Examples Included

### 1. Webhook Approval Flow (`webhook-approval.ts` + `approve-step.ts`)

**Pattern**: `awaitBefore` with webhook
**Use Case**: Manager approval required before processing

**Flow Steps**:
1. Entry step creates approval request
2. Process step awaits webhook call
3. Webhook provides approval/denial
4. Flow continues or fails based on response

**Testing**:
```bash
# 1. Start the flow via UI at /triggers
# 2. Check console for webhook URL
# 3. Call webhook:
curl -X POST http://localhost:3000/api/_webhook/await/approve/{runId}/process-approval \
  -H "Content-Type: application/json" \
  -d '{"approved": true, "approvedBy": "Manager", "comment": "Approved"}'
```

### 2. Notification with Time Delay (`notification-with-delay.ts` + `follow-up-step.ts`)

**Pattern**: `awaitAfter` with time delay
**Use Case**: Rate limiting, scheduled follow-ups

**Flow Steps**:
1. Send notification
2. Wait 10 seconds (awaitAfter)
3. Follow-up step runs automatically

**Testing**:
- Start flow via UI at `/triggers`
- Watch logs for 10-second pause
- Follow-up runs automatically after delay

### 3. Order Processing with Event (`order-create.ts` + `order-process.ts`)

**Pattern**: `awaitBefore` with event
**Use Case**: Wait for external service (payment gateway)

**Flow Steps**:
1. Create order
2. Wait for `payment.completed` event
3. Process order after payment received

**Testing**:
```bash
# 1. Start flow via UI at /triggers
# 2. Emit payment event:
curl -X POST http://localhost:3000/api/test/emit-event \
  -H "Content-Type: application/json" \
  -d '{"eventName": "payment.completed", "payload": {"amount": 100}}'
```

## Testing UI

Visit `http://localhost:3000/triggers` for interactive testing interface.

### Features:
- **Flow Selection**: Choose from 3 example flows
- **Custom Test Data**: Modify JSON payloads
- **Webhook Testing**: Call webhooks with custom data
- **Event Emission**: Fire events to resolve awaits
- **Instructions**: Step-by-step testing guides

## Architecture Highlights

### Event-Driven
- All operations use event bus
- Worker publishes `await.registered` events
- Trigger wiring handles state management

### Lifecycle Hooks
- `onAwaitRegister`: Called when await is registered
- `onAwaitResolve`: Called when await is resolved
- Access to full context (runId, stepName, data)

### Clean Separation
- Workers: Business logic only
- Wiring: State management and orchestration
- Handlers: HTTP interface to events

## Adding New Examples

1. **Create trigger** in `server/triggers/`:
```typescript
import { defineTriggerConfig } from '#imports'

export const config = defineTriggerConfig({
  name: 'manual.my-test',
  type: 'manual',
  scope: 'flow',
  displayName: 'My Test Trigger',
  description: 'Test trigger description',
})
```

2. **Create flow steps** in `server/functions/examples/`:
```typescript
import { defineFunctionConfig, defineFunction } from '#imports'

export const config = defineFunctionConfig({
  queue: { name: 'test' },
  flow: {
    name: 'my-flow',
    role: 'entry',
    step: 'my-step',
    triggers: {
      subscribe: ['manual.my-test'],
      mode: 'auto',
    },
    awaitBefore: {
      type: 'webhook',
      path: '/test/{runId}',
      timeout: 300000,
    },
  },
})

export default defineFunction(async (input, ctx) => {
  // Your logic here
  return { success: true }
})
```

3. **Add to UI** in `app/pages/triggers.vue`:
```typescript
const flowExamples = [
  // ... existing examples
  {
    id: 'my-flow',
    name: 'My Flow',
    description: 'Description of my flow',
    trigger: 'manual.my-test',
    testData: { key: 'value' },
    awaitType: 'webhook',
    instructions: 'Instructions for testing',
  },
]
```

## Debugging

### Check Flow Status
```bash
# View flow run events
curl http://localhost:3000/api/test/flow/events?flowId={runId}
```

### Check Await State
```bash
# View flow metadata (includes awaitingSteps)
curl http://localhost:3000/api/test/flow/status?flowId={runId}
```

### Watch Logs
- Server console shows detailed await lifecycle
- Browser console shows webhook URLs and event emissions
- Lifecycle hooks log registration and resolution

## Patterns Summary

| Pattern | Type | Use When | Example |
|---------|------|----------|---------|
| `awaitBefore` + webhook | External trigger | Human approval, 3rd party callback | Approval flows |
| `awaitBefore` + event | Internal event | Service coordination | Payment processing |
| `awaitBefore` + time | Scheduled delay | Timed execution | Scheduled tasks |
| `awaitAfter` + webhook | Confirmation | Receipt confirmation | Delivery confirmation |
| `awaitAfter` + time | Rate limiting | Throttle next steps | Rate-limited APIs |

## Next Steps

1. Try all 3 example flows
2. Modify test data and observe behavior
3. Check console logs for lifecycle events
4. Create your own flow patterns
5. Test timeout handling (reduce timeout, wait for expiry)
