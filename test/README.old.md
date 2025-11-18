# Nvent Test Suite

Comprehensive unit testing for nvent v0.4 using Nuxt's test utilities and Vitest.

## Structure

```
test/
├── fixtures/          # Test Nuxt applications
│   ├── base/         # Shared fixture with server functions
│   ├── memory.config.ts  # Memory adapter configuration
│   └── file.config.ts    # File adapter configuration
├── unit/             # Unit tests using nvent utilities directly
│   ├── configuration.test.ts
│   ├── memory-queue.test.ts
│   ├── memory-store.test.ts
│   ├── flow-engine.test.ts
│   └── state-adapter.test.ts
└── helpers/          # Test helpers
```

## Running Tests

```bash
# All tests
pnpm test

# Run in watch mode
pnpm test:unit

# With coverage
pnpm test:coverage
```

## Test Approach

Tests directly use nvent runtime utilities (`useQueueAdapter`, `useFlowEngine`, etc.) within a Nuxt test context via `@nuxt/test-utils`.

### Available Utilities

```typescript
const { useQueueAdapter } = await import('#imports')    // Queue operations
const { useStoreAdapter } = await import('#imports')    // Store operations
const { useStateAdapter } = await import('#imports')    // State management
const { useFlowEngine } = await import('#imports')      // Flow control
```

## Writing Tests

```typescript
import { describe, it, expect, beforeAll } from 'vitest'
import { fileURLToPath } from 'node:url'
import { setup } from '@nuxt/test-utils'

describe('my feature', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('../../fixtures/base', import.meta.url)),
    configFile: fileURLToPath(new URL('../../fixtures/memory.config.ts', import.meta.url)),
  })

  let queue: any

  beforeAll(async () => {
    const { useQueueAdapter } = await import('#imports')
    queue = useQueueAdapter()
  })

  it('works', async () => {
    const jobId = await queue.enqueue('test', { name: 'job', data: {} })
    expect(jobId).toBeDefined()
  })
})
```

## Test Fixtures

**Base Fixture** - Shared Nuxt app with test functions
**Memory Config** - In-memory adapters (fast, isolated)
**File Config** - File-based adapters (persistence testing)
