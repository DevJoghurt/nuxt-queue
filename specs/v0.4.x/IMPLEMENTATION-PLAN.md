# v0.4.1 Implementation Plan

**Project:** nuxt-queue → nvent  
**Version:** 0.4.1  
**Status:** 🚀 Ready to Start  
**Estimated Duration:** 4-6 weeks  
**Last Updated:** November 7, 2025

## Overview

This document outlines the step-by-step implementation plan for transforming nuxt-queue into nvent v0.4.1 with a monorepo structure and adapter system.

**Key Objectives:**
1. ✅ Set up monorepo with pnpm workspaces
2. ✅ Rename project to nvent with new branding
3. ✅ Create adapter system (queue, stream, store)
4. ✅ Extract Redis adapters to separate packages
5. ✅ Implement built-in memory/file adapters
6. ✅ Update API: `defineFunction()` and `defineFunctionConfig()`
7. ✅ Migrate playground and tests
8. ✅ Update documentation

---

## Phase 0: Preparation (Week 1, Days 1-2)

**Goal:** Set up monorepo structure and tooling

### Tasks

- [ ] **0.1: Create monorepo structure**
  ```bash
  # Create directory structure
  mkdir -p packages/nvent
  mkdir -p packages/adapter-queue-redis
  mkdir -p packages/adapter-stream-redis
  mkdir -p packages/adapter-store-redis
  
  # Move existing code to packages/nvent
  git mv src packages/nvent/src
  git mv test packages/nvent/test
  ```

- [ ] **0.2: Set up pnpm workspace**
  ```yaml
  # pnpm-workspace.yaml
  packages:
    - 'packages/*'
    - 'playground'
  ```

- [ ] **0.3: Update root package.json**
  ```json
  {
    "name": "nvent-monorepo",
    "private": true,
    "workspaces": ["packages/*", "playground"],
    "scripts": {
      "dev": "pnpm -r --parallel dev",
      "build": "pnpm -r build",
      "test": "pnpm -r test",
      "lint": "pnpm -r lint"
    }
  }
  ```

- [ ] **0.4: Create packages/nvent/package.json**
  ```json
  {
    "name": "nvent",
    "version": "0.4.1",
    "description": "Event-driven workflows for Nuxt",
    "main": "./dist/module.mjs",
    "types": "./dist/types.d.ts"
  }
  ```

- [ ] **0.5: Set up TypeScript project references**
  ```json
  // tsconfig.json (root)
  {
    "references": [
      { "path": "./packages/nvent" },
      { "path": "./packages/adapter-queue-redis" },
      { "path": "./packages/adapter-stream-redis" },
      { "path": "./packages/adapter-store-redis" }
    ]
  }
  ```

- [ ] **0.6: Test monorepo setup**
  ```bash
  pnpm install
  pnpm -r build
  ```

**Deliverables:**
- ✅ Working monorepo structure
- ✅ pnpm workspace configured
- ✅ TypeScript project references set up
- ✅ All packages build successfully

**Estimated Time:** 2 days

---

## Phase 1: Core Restructuring (Week 1, Days 3-7)

**Goal:** Create adapter interfaces and refactor core to use adapter registry

### Tasks

#### 1.1: Create Adapter Interfaces

- [ ] **Create `packages/nvent/src/runtime/server/adapters/interfaces/queue.ts`**
  ```typescript
  export interface QueueAdapter {
    init(): Promise<void>
    enqueue(queue: string, job: JobInput): Promise<string>
    schedule(queue: string, job: JobInput, opts?: ScheduleOptions): Promise<string>
    getJob(queue: string, id: string): Promise<Job | null>
    getJobs(queue: string, query?: JobsQuery): Promise<Job[]>
    getJobCounts(queue: string): Promise<JobCounts>
    pause(queue: string): Promise<void>
    resume(queue: string): Promise<void>
    isPaused(queue: string): Promise<boolean>
    on(queue: string, event: QueueEvent, cb: (p: any) => void): () => void
    close(): Promise<void>
  }
  ```

- [ ] **Create `packages/nvent/src/runtime/server/adapters/interfaces/stream.ts`**
  ```typescript
  export interface StreamAdapter {
    init(): Promise<void>
    publish(topic: string, event: StreamEvent): Promise<void>
    subscribe(topic: string, handler: Function, opts?: SubscribeOptions): Promise<SubscriptionHandle>
    unsubscribe(handle: SubscriptionHandle): Promise<void>
    listTopics(): Promise<string[]>
    getSubscriptionCount(topic: string): Promise<number>
    shutdown(): Promise<void>
  }
  ```

- [ ] **Create `packages/nvent/src/runtime/server/adapters/interfaces/store.ts`**
  ```typescript
  export interface StoreAdapter {
    close(): Promise<void>
    
    // Event Stream
    append(subject: string, event: Omit<EventRecord, 'id' | 'ts'>): Promise<EventRecord>
    read(subject: string, opts?: EventReadOptions): Promise<EventRecord[]>
    subscribe(subject: string, onEvent: (e: EventRecord) => void): Promise<EventSubscription>
    
    // Document Store
    save(collection: string, id: string, doc: Record<string, any>): Promise<void>
    get(collection: string, id: string): Promise<Record<string, any> | null>
    list(collection: string, opts?: ListOptions): Promise<Array<{ id: string; doc: any }>>
    delete(collection: string, id: string): Promise<void>
    
    // Key-Value Store
    kv: {
      get<T>(key: string): Promise<T | null>
      set<T>(key: string, value: T, ttl?: number): Promise<void>
      delete(key: string): Promise<void>
      clear(pattern: string): Promise<number>
    }
  }
  ```

#### 1.2: Create Adapter Registry

- [ ] **Create `packages/nvent/src/runtime/server/adapters/registry.ts`**
  ```typescript
  export class AdapterRegistry {
    private queueAdapters = new Map<string, QueueAdapter>()
    private streamAdapters = new Map<string, StreamAdapter>()
    private storeAdapters = new Map<string, StoreAdapter>()
    
    registerQueue(name: string, adapter: QueueAdapter): void
    registerStream(name: string, adapter: StreamAdapter): void
    registerStore(name: string, adapter: StoreAdapter): void
    
    getQueue(name: string): QueueAdapter
    getStream(name: string): StreamAdapter
    getStore(name: string): StoreAdapter
  }
  ```

- [ ] **Add Nuxt hook for adapter registration**
  ```typescript
  // packages/nvent/src/module.ts
  nuxt.hook('ready', () => {
    nuxt.callHook('nvent:registerAdapter', registry, config)
  })
  ```

#### 1.3: Implement Built-in Adapters

- [ ] **Memory Queue Adapter: `packages/nvent/src/runtime/server/adapters/builtin/memory-queue.ts`**
  - Implement QueueAdapter interface
  - Use Map for job storage
  - EventEmitter for queue events
  - Simple in-memory processing

- [ ] **Memory Stream Adapter: `packages/nvent/src/runtime/server/adapters/builtin/memory-stream.ts`**
  - Implement StreamAdapter interface
  - Use EventEmitter for pub/sub
  - In-memory topic management

- [ ] **Memory Store Adapter: `packages/nvent/src/runtime/server/adapters/builtin/memory-store.ts`**
  - Implement StoreAdapter interface
  - Map-based event stream
  - Map-based document store
  - Map-based key-value store

- [ ] **File Queue Adapter: `packages/nvent/src/runtime/server/adapters/builtin/file-queue.ts`**
  - Same as memory but persists to JSON files
  - Use `.nvent/queues/` directory

- [ ] **File Stream Adapter: `packages/nvent/src/runtime/server/adapters/builtin/file-stream.ts`**
  - Persist topics to JSON files
  - Use `.nvent/streams/` directory

- [ ] **File Store Adapter: `packages/nvent/src/runtime/server/adapters/builtin/file-store.ts`**
  - Persist events to JSON files
  - Use `.nvent/store/` directory

#### 1.4: Update Config Types

- [ ] **Update `packages/nvent/src/config/types.ts`**
  ```typescript
  export interface ModuleOptions {
    dir?: string  // Default: 'server/functions'
    ui?: boolean
    debug?: Record<string, any>
    
    queue?: QueueAdapterConfig
    stream?: StreamAdapterConfig
    store?: StoreAdapterConfig
  }
  ```

**Deliverables:**
- ✅ Three adapter interfaces defined
- ✅ AdapterRegistry implemented
- ✅ Six built-in adapters (memory + file for each type)
- ✅ Config types updated
- ✅ Nuxt hook for adapter registration

**Estimated Time:** 5 days

---

## Phase 2: Extract Redis Adapters (Week 2)

**Goal:** Move Redis/BullMQ implementation to separate packages

### Tasks

#### 2.1: Create Queue Adapter Package

- [ ] **Create `packages/adapter-queue-redis/package.json`**
  ```json
  {
    "name": "@nvent/adapter-queue-redis",
    "version": "0.4.1",
    "peerDependencies": {
      "nvent": "^0.4.1"
    },
    "dependencies": {
      "bullmq": "^5.0.0",
      "ioredis": "^5.0.0"
    }
  }
  ```

- [ ] **Extract BullMQ code to `packages/adapter-queue-redis/src/adapter.ts`**
  - Move current queue/bullmq code
  - Implement QueueAdapter interface
  - Keep all BullMQ-specific logic

- [ ] **Create Nuxt module: `packages/adapter-queue-redis/src/module.ts`**
  ```typescript
  export default defineNuxtModule({
    meta: { name: '@nvent/adapter-queue-redis' },
    setup(options, nuxt) {
      nuxt.hook('nvent:registerAdapter', (registry, config) => {
        const redisConfig = config.queue?.redis
        if (redisConfig) {
          const adapter = new RedisQueueAdapter(redisConfig)
          registry.registerQueue('redis', adapter)
        }
      })
    }
  })
  ```

#### 2.2: Create Stream Adapter Package

- [ ] **Create `packages/adapter-stream-redis/package.json`**

- [ ] **Extract Redis Pub/Sub to `packages/adapter-stream-redis/src/adapter.ts`**
  - Extract RedisPubSubGateway from eventStoreAdapter
  - Implement StreamAdapter interface
  - Move Redis Pub/Sub logic

- [ ] **Create Nuxt module: `packages/adapter-stream-redis/src/module.ts`**

#### 2.3: Create Store Adapter Package

- [ ] **Create `packages/adapter-store-redis/package.json`**

- [ ] **Extract EventStore to `packages/adapter-store-redis/src/adapter.ts`**
  - Move current eventStore Redis implementation
  - Remove pub/sub logic (now in StreamAdapter)
  - Implement new StoreAdapter interface with document/kv stores
  - Use Redis Streams for events, Hashes for documents, GET/SET for kv

- [ ] **Create Nuxt module: `packages/adapter-store-redis/src/module.ts`**

#### 2.4: Update Core to Use Adapters

- [ ] **Update `packages/nvent/src/runtime/server/queue/queueFactory.ts`**
  ```typescript
  export function useQueue() {
    const registry = useAdapterRegistry()
    const config = useRuntimeConfig().nvent
    const adapter = registry.getQueue(config.queue.adapter)
    return createQueueProvider(adapter)
  }
  ```

- [ ] **Update `packages/nvent/src/runtime/server/events/eventStoreFactory.ts`**
  ```typescript
  export function useEventStore() {
    const registry = useAdapterRegistry()
    const config = useRuntimeConfig().nvent
    const storeAdapter = registry.getStore(config.store.adapter)
    const streamAdapter = registry.getStream(config.stream.adapter)
    return createEventStore(storeAdapter, streamAdapter)
  }
  ```

**Deliverables:**
- ✅ Three separate adapter packages
- ✅ Each adapter is a standalone Nuxt module
- ✅ Core uses adapter registry instead of direct imports
- ✅ Redis logic extracted from core

**Estimated Time:** 7 days

---

## Phase 3: API Migration (Week 3, Days 1-3)

**Goal:** Update function definition API and directory structure

### Tasks

#### 3.1: Update Function Wrappers

- [ ] **Rename `defineQueueWorker` → `defineFunction`**
  ```typescript
  // packages/nvent/src/runtime/server/utils/defineFunction.ts
  export type DefineFunction = (
    handler: (input: any, ctx: ExtendedRunContext) => Promise<any>
  ) => NodeHandler
  
  export const defineFunction: DefineFunction = (handler) => {
    // Same implementation as current defineQueueWorker
    return wrapped
  }
  ```

- [ ] **Rename `defineQueueConfig` → `defineFunctionConfig`**
  ```typescript
  // packages/nvent/src/runtime/server/utils/defineFunctionConfig.ts
  export const defineFunctionConfig: DefineConfig = cfg => cfg
  ```

- [ ] **Update auto-imports in `packages/nvent/src/module.ts`**
  ```typescript
  addImports([
    { name: 'defineFunction', from: resolver.resolve('./runtime/server/utils/defineFunction') },
    { name: 'defineFunctionConfig', from: resolver.resolve('./runtime/server/utils/defineFunctionConfig') }
  ])
  ```

#### 3.2: Update Registry Scanner

- [ ] **Update `packages/nvent/src/registry/scan.ts`**
  - Change default directory from `server/queues` to `server/functions`
  - Look for both `defineFunction` and `defineQueueWorker` (temporary)
  - Warn about deprecated `defineQueueWorker` usage

#### 3.3: Add Migration Helpers

- [ ] **Create migration script: `packages/nvent/scripts/migrate-v0.4.1.ts`**
  ```typescript
  // Automated migration script
  - Rename server/queues → server/functions
  - Replace defineQueueWorker → defineFunction
  - Replace defineQueueConfig → defineFunctionConfig
  - Update imports
  ```

**Deliverables:**
- ✅ New API wrappers: `defineFunction`, `defineFunctionConfig`
- ✅ Default directory changed to `server/functions`
- ✅ Migration script for automated updates
- ✅ Backward compatibility warnings

**Estimated Time:** 3 days

---

## Phase 4: Testing & Validation (Week 3, Days 4-7)

**Goal:** Ensure all adapters work correctly and tests pass

### Tasks

#### 4.1: Update Unit Tests

- [ ] **Test built-in adapters**
  - `test/adapters/memory-queue.test.ts`
  - `test/adapters/memory-stream.test.ts`
  - `test/adapters/memory-store.test.ts`
  - `test/adapters/file-queue.test.ts`
  - `test/adapters/file-stream.test.ts`
  - `test/adapters/file-store.test.ts`

- [ ] **Test adapter registry**
  - `test/adapters/registry.test.ts`
  - Registration and retrieval
  - Error handling

- [ ] **Test adapter switching**
  - Verify same code works with memory/file/redis adapters
  - Test config-based adapter selection

#### 4.2: Update Integration Tests

- [ ] **Update `test/flows.e2e.test.ts`**
  - Test with memory adapter (fast)
  - Test with file adapter (persistent)
  - Ensure same results across adapters

- [ ] **Update `test/state.unit.test.ts`**
  - Test new StoreAdapter kv methods
  - Test document store methods
  - Test event stream methods

#### 4.3: Create Adapter Tests

- [ ] **Create `packages/adapter-queue-redis/test/adapter.test.ts`**
- [ ] **Create `packages/adapter-stream-redis/test/adapter.test.ts`**
- [ ] **Create `packages/adapter-store-redis/test/adapter.test.ts`**

#### 4.4: Performance Testing

- [ ] **Benchmark adapters: `test/benchmarks/adapters.bench.ts`**
  - Memory vs File vs Redis
  - Job throughput
  - Event append/read performance
  - State get/set performance

**Deliverables:**
- ✅ All tests passing with new adapter system
- ✅ Tests for all built-in adapters
- ✅ Tests for Redis adapters
- ✅ Performance benchmarks

**Estimated Time:** 4 days

---

## Phase 5: Playground Migration (Week 4, Days 1-2)

**Goal:** Update playground to use new API and structure

### Tasks

- [ ] **Migrate playground directory structure**
  ```bash
  mv playground/server/queues playground/server/functions
  ```

- [ ] **Update playground/nuxt.config.ts**
  ```typescript
  export default defineNuxtConfig({
    modules: [
      'nvent',
      // '@nvent/adapter-queue-redis',  // Optional for testing
      // '@nvent/adapter-stream-redis',
      // '@nvent/adapter-store-redis'
    ],
    
    nvent: {
      dir: 'server/functions',
      
      // Use memory adapters by default (fast dev)
      queue: { adapter: 'memory' },
      stream: { adapter: 'memory' },
      store: { adapter: 'memory' }
    }
  })
  ```

- [ ] **Update all playground function files**
  ```typescript
  // Before
  export const config = defineQueueConfig({ ... })
  export default defineQueueWorker(async (payload, ctx) => { ... })
  
  // After
  export const config = defineFunctionConfig({ ... })
  export default defineFunction(async (payload, ctx) => { ... })
  ```

- [ ] **Test playground functionality**
  - All flows work with memory adapters
  - UI displays correctly
  - State management works
  - Events are logged

**Deliverables:**
- ✅ Playground uses new API
- ✅ Playground uses memory adapters by default
- ✅ All examples work correctly

**Estimated Time:** 2 days

---

## Phase 6: Documentation (Week 4, Days 3-7)

**Goal:** Update all documentation for v0.4.1

### Tasks

#### 6.1: Update Main README

- [ ] **Update `README.md`**
  - Change project name to nvent
  - Update installation instructions
  - Show new API: `defineFunction`, `defineFunctionConfig`
  - Document adapter system
  - Add migration guide from v0.4.0

#### 6.2: Create Adapter Documentation

- [ ] **Create `docs/adapters/overview.md`**
  - Explain three adapter types
  - When to use each adapter
  - Adapter selection guide

- [ ] **Create `docs/adapters/queue.md`**
  - QueueAdapter interface
  - Built-in: memory, file
  - External: @nvent/adapter-queue-redis

- [ ] **Create `docs/adapters/stream.md`**
  - StreamAdapter interface
  - Built-in: memory, file
  - External: @nvent/adapter-stream-redis

- [ ] **Create `docs/adapters/store.md`**
  - StoreAdapter interface
  - Three storage paradigms
  - Built-in: memory, file
  - External: @nvent/adapter-store-redis

- [ ] **Create `docs/adapters/custom.md`**
  - How to create custom adapters
  - Publishing to npm
  - Example implementations

#### 6.3: Update Migration Guide

- [ ] **Create `docs/migration/v0.4.0-to-v0.4.1.md`**
  - API changes
  - Config changes
  - Adapter migration
  - Breaking changes
  - Automated migration script usage

#### 6.4: Update Examples

- [ ] **Update all example code snippets**
- [ ] **Add adapter-specific examples**
- [ ] **Add monorepo setup example**

**Deliverables:**
- ✅ Complete documentation for v0.4.1
- ✅ Adapter guides
- ✅ Migration guide
- ✅ Updated examples

**Estimated Time:** 5 days

---

## Phase 7: Release Preparation (Week 5-6)

**Goal:** Prepare for v0.4.1 release

### Tasks

#### 7.1: Package Publishing

- [ ] **Set up npm organization: `@nvent`**
- [ ] **Configure publishConfig in all packages**
  ```json
  {
    "publishConfig": {
      "access": "public",
      "registry": "https://registry.npmjs.org/"
    }
  }
  ```

- [ ] **Create release script: `scripts/release.sh`**
  ```bash
  #!/bin/bash
  # Build all packages
  pnpm -r build
  
  # Run tests
  pnpm -r test
  
  # Publish packages
  pnpm -r publish --access public
  ```

#### 7.2: Changelog

- [ ] **Create `CHANGELOG.md`**
  ```markdown
  # v0.4.1 (2025-11-XX)
  
  ## 🎉 Major Changes
  - Renamed project to nvent
  - Monorepo structure with adapter system
  - New API: defineFunction, defineFunctionConfig
  
  ## ✨ Features
  - Built-in memory and file adapters
  - Three adapter types: queue, stream, store
  - Adapter registry with Nuxt hooks
  
  ## 💥 Breaking Changes
  - Directory changed: server/queues → server/functions
  - API renamed: defineQueueWorker → defineFunction
  - Config structure changed
  
  ## 🔄 Migration
  See docs/migration/v0.4.0-to-v0.4.1.md
  ```

#### 7.3: GitHub Release

- [ ] **Create GitHub release**
- [ ] **Tag version: `v0.4.1`**
- [ ] **Attach migration guide**
- [ ] **Announce on social media**

#### 7.4: Post-Release

- [ ] **Monitor GitHub issues**
- [ ] **Respond to community feedback**
- [ ] **Plan v0.4.2 patches if needed**

**Deliverables:**
- ✅ All packages published to npm
- ✅ GitHub release created
- ✅ Changelog published
- ✅ Community notified

**Estimated Time:** Variable (1-2 weeks)

---

## Success Criteria

### ✅ Phase 0: Preparation
- [ ] Monorepo builds without errors
- [ ] All packages have correct dependencies
- [ ] TypeScript compilation works

### ✅ Phase 1: Core Restructuring
- [ ] Three adapter interfaces defined
- [ ] Adapter registry works
- [ ] Six built-in adapters implemented
- [ ] Tests pass with memory adapter

### ✅ Phase 2: Extract Redis Adapters
- [ ] Three Redis adapter packages created
- [ ] Each adapter is a Nuxt module
- [ ] Core uses adapter registry
- [ ] Tests pass with Redis adapters

### ✅ Phase 3: API Migration
- [ ] New API wrappers work
- [ ] Default directory changed
- [ ] Migration script works
- [ ] Backward compatibility warnings shown

### ✅ Phase 4: Testing & Validation
- [ ] All tests pass
- [ ] Performance benchmarks done
- [ ] No regressions from v0.4.0

### ✅ Phase 5: Playground Migration
- [ ] Playground uses new API
- [ ] All examples work
- [ ] UI functions correctly

### ✅ Phase 6: Documentation
- [ ] README updated
- [ ] Adapter docs complete
- [ ] Migration guide written
- [ ] Examples updated

### ✅ Phase 7: Release
- [ ] Packages published
- [ ] GitHub release created
- [ ] Community notified

---

## Risk Management

### Risk: Breaking Changes

**Mitigation:**
- Provide migration script
- Clear migration guide
- Deprecation warnings in v0.4.0
- Community support during migration

### Risk: Performance Regression

**Mitigation:**
- Benchmark against v0.4.0
- Profile adapter overhead
- Optimize hot paths
- Document performance characteristics

### Risk: Adapter Compatibility

**Mitigation:**
- Comprehensive adapter tests
- Integration tests with all adapters
- Document adapter limitations
- Provide adapter development guide

### Risk: Timeline Overrun

**Mitigation:**
- Break phases into smaller tasks
- Focus on MVP first (memory adapter)
- Defer nice-to-have features
- Regular progress reviews

---

## Dependencies & Prerequisites

### Development Environment
- Node.js 18+
- pnpm 8+
- TypeScript 5+
- Git

### External Services (for testing)
- Redis (optional, for adapter testing)
- PostgreSQL (optional, for future adapters)

### Team Knowledge
- Nuxt 3 module development
- Monorepo management with pnpm
- TypeScript advanced types
- Queue systems (BullMQ)
- Testing strategies

---

## Communication Plan

### Weekly Progress Updates
- Every Friday: Team sync on completed tasks
- Document blockers and solutions
- Adjust timeline if needed

### Community Updates
- Weekly blog posts on progress
- Twitter updates on milestones
- Discord discussions for feedback

### Documentation
- Keep IMPLEMENTATION-PLAN.md updated
- Document decisions in specs/v0.4.1/
- Update issue tracker

---

## Next Steps

1. **Review this plan** with team
2. **Set up project board** with all tasks
3. **Assign tasks** to team members
4. **Start Phase 0** tomorrow
5. **Daily standups** to track progress

---

**Plan Status:** ✅ Ready to Execute  
**Start Date:** TBD  
**Target Completion:** 4-6 weeks from start  
**Last Updated:** November 7, 2025
