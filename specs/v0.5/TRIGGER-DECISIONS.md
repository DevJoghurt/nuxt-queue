# Trigger System Architecture Decisions

> **Date**: 2025-11-19  
> **Context**: v0.5 Trigger System Design

## Key Decisions

### 1. Subscription Direction: One-Way (Flows → Triggers)

**Decision**: Flows subscribe to triggers, not the other way around.

```typescript
// ✅ CORRECT
registerTrigger({ name: 'user.created', ... })  // Independent

export const config = defineFunctionConfig({
  flow: {
    triggers: { subscribe: ['user.created'] }  // Flow subscribes
  }
})

// ❌ NOT THIS
registerTrigger({ 
  name: 'user.created',
  subscribers: ['onboarding-flow']  // Trigger doesn't know flows
})
```

**Rationale**:

1. **Loose Coupling**
   - Triggers don't need to know about flows
   - Add/remove flows without updating triggers
   - Flows are consumers, triggers are producers (pub/sub pattern)

2. **Dynamic Subscription**
   - Flows can subscribe/unsubscribe at runtime
   - Support A/B testing (route to different flows)
   - Feature flags (enable/disable flow triggers)

3. **Reusability**
   - Same trigger can be used by unlimited flows
   - No trigger updates when adding new flows
   - Triggers are stable, flows are dynamic

4. **Distributed Architecture**
   - Flows can be in different containers
   - No need to coordinate trigger definitions across instances
   - Event-based discovery works naturally

5. **Hot Reload Friendly**
   - Change flow subscriptions without touching triggers
   - Dev mode file watcher only needs to reload flows
   - Triggers remain stable during development

**Bidirectional Index (Runtime)**:

While subscription is one-way in configuration, the **runtime** maintains a bidirectional index for efficiency:

```typescript
interface TriggerRuntime {
  // Primary: From flow configs
  triggerToFlows: Map<string, Set<FlowSubscription>>  // Trigger → Flows
  
  // Reverse: Auto-built from above
  flowToTriggers: Map<string, Set<string>>            // Flow → Triggers
  
  // Trigger definitions
  triggers: Map<string, TriggerDefinition>
}
```

This gives us both:
- **Configuration simplicity** (flows subscribe to triggers)
- **Runtime efficiency** (lookup in either direction)

### 2. Optional Bidirectional Hints

**Decision**: Triggers can optionally declare `expectedSubscribers` for **validation only**.

```typescript
registerTrigger({
  name: 'user.created',
  // Optional: Expected subscribers (not enforced)
  expectedSubscribers: ['onboarding-flow', 'notification-flow']
})
```

**Rationale**:

1. **Validation**
   - Warn if expected flows are missing
   - Detect configuration errors early
   - Help developers understand dependencies

2. **Documentation**
   - Self-documenting trigger usage
   - Shows intended flow architecture
   - Useful for new team members

3. **Discovery**
   - See which flows should use this trigger
   - Understand trigger impact
   - Plan changes carefully

4. **Not Enforced**
   - Doesn't prevent flows from subscribing
   - Doesn't prevent flows from unsubscribing
   - Warnings only, not errors

**When to use**:
- ✅ Critical triggers that should always have subscribers
- ✅ Triggers with known, stable consumers
- ✅ Documentation/validation purposes
- ❌ Don't use for experimental/optional triggers
- ❌ Don't use if subscribers change frequently

### 3. Hybrid Registration (Runtime + Programmatic)

**Decision**: Support **both** file-based configuration and programmatic API.

#### File-Based Configuration (Auto-Discovery)

```typescript
// server/functions/payment-flow/start.ts
export const config = defineFunctionConfig({
  flow: {
    triggers: {
      subscribe: ['stripe.payment.succeeded']
    }
  }
})
```

**Pros**:
- ✅ Discoverable (file scan)
- ✅ Hot reload in dev mode
- ✅ Type-safe
- ✅ Git-tracked configuration
- ✅ Easy to audit/review

**Best for**: Stable, base configuration

#### Programmatic API (Runtime Registration)

```typescript
// server/plugins/dynamicTriggers.ts
export default defineNitroPlugin(() => {
  const { subscribeTrigger } = useTriggers()
  
  subscribeTrigger({
    trigger: 'stripe.payment.succeeded',
    flow: 'payment-flow',
    mode: 'auto',
    filter: (data) => data.amount > 100  // Only large payments
  })
})
```

**Pros**:
- ✅ Dynamic (runtime changes)
- ✅ Conditional (feature flags, env vars)
- ✅ Programmatic logic (filters, transforms)
- ✅ A/B testing support
- ✅ No file changes needed

**Best for**: Dynamic, conditional, runtime modifications

#### Why Both?

1. **Flexibility**
   - Different use cases need different approaches
   - Combine static base + dynamic extensions
   - Balance simplicity and power

2. **Development Workflow**
   - File-based: Quick setup, discoverable
   - Programmatic: Testing, experimentation

3. **Production Patterns**
   - File-based: Stable, auditable
   - Programmatic: Feature flags, A/B tests

4. **Migration Path**
   - Start with file-based (simple)
   - Add programmatic when needed (advanced)

#### Hybrid Example

```typescript
// Base configuration (file-based)
export const config = defineFunctionConfig({
  flow: {
    triggers: {
      subscribe: ['stripe.payment.succeeded']  // Always active
    }
  }
})

// + Dynamic subscription (programmatic)
export default defineNitroPlugin(() => {
  if (process.env.FEATURE_TEST_MODE) {
    subscribeTrigger({
      trigger: 'test.payment',
      flow: 'payment-flow'
    })
  }
})
```

### 4. Event-Based Registry (v0.8 Pattern)

**Decision**: Integrate with v0.8 distributed architecture using event-based registry.

**Rationale**:

1. **Consistency**
   - Same pattern as worker/step registration
   - Reuse event store infrastructure
   - Unified distributed architecture

2. **Distributed Ready**
   - Multiple instances can discover triggers
   - No central coordination needed
   - Event stream provides audit trail

3. **Simple Implementation**
   - Reuse existing event system
   - No new Redis keys/patterns
   - Less code to maintain

**Implementation**:

```typescript
// Emit trigger subscriptions to event store
await eventManager.emit('trigger.subscription.registered', {
  instanceId,
  triggerName: 'user.created',
  subscribedFlows: ['onboarding-flow', 'notification-flow'],
  timestamp: new Date().toISOString()
})
```

This enables:
- ✅ Instance discovery (who has what triggers)
- ✅ Health monitoring (instance heartbeats)
- ✅ Audit trail (subscription history)
- ✅ Debugging (trace trigger routing)

## Summary

| Decision | Choice | Why |
|----------|--------|-----|
| **Subscription Direction** | One-way (flows → triggers) | Loose coupling, dynamic, reusable |
| **Bidirectional Hints** | Optional `expectedSubscribers` | Validation + documentation only |
| **Registration Style** | Hybrid (file + programmatic) | Flexibility for all use cases |
| **Registry Architecture** | Event-based (v0.8 pattern) | Distributed ready, consistent |

## Migration Impact

✅ **No breaking changes**
- Existing flow subscriptions continue to work
- New features are opt-in
- Programmatic API is additive

✅ **Clear upgrade path**
1. Start with file-based configs (simple)
2. Add programmatic API when needed (advanced)
3. Use distributed registry in production (scale)

✅ **Backward compatible**
- v0.4 patterns still work
- Gradual migration possible
- Both old and new can coexist
