# Nuxt Queue: Motia-inspired Architecture Spec

Status: Draft
Owner: DevJoghurt
Last updated: 2025-10-18
Target branch: refactoring

## 1) Motivation and Goals

We want to evolve `nuxt-queue` with a Motia-inspired architecture that:
- Introduces runtime workers (TypeScript and Python) with a single abstraction.
- Adds a stream-first execution model (progress, logs, partial outputs).
- Abstracts queue backends (BullMQ for Redis, PgBoss for Postgres) behind a common provider.
- Abstracts logging behind a provider (BullMQ logger; PgBoss logger wrapper).
- Adds a state provider to persist/recover workflow state (Redis via Nitro `useStorage`, Postgres via Nitro `useDatabase`).
- Keeps a Nuxt-native developer experience (SSR-friendly, module options-driven, explicit imports with auto-imports disabled).

Non-goals (for now):
- Full workflow DSL or visual builder.
- Cross-language function packaging/bundling beyond basic TS/Python runners.
- Multi-tenant isolation or strict sandboxing guarantees.


## 2) High-level Architecture

```
+-------------------+          +----------------------+          +-------------------+
|  Client (Vue)     |  WS/SSE  |  Nuxt Server (Nitro) |  Provider API  |  Backend(s)   |
|  - UI subscribes  +<-------->+  - Runner Orchestr.  +<------------->+  Redis/PG      |
|  - control cmds   |          |  - Providers (queue, |                 |  BullMQ/PgBoss|
+-------------------+          |    state, logger)    |                 +---------------+
                               |  - Streaming bridge  |
                               +----------------------+
```

- Runner Orchestrator exposes a uniform execution API. It delegates to a TS or Python runner.
- Providers encapsulate concrete tech:
  - QueueProvider: BullMQ or PgBoss
  - LoggerProvider: BullMQ logger or a thin wrapper for PgBoss
  - StateProvider: Redis (unstorage) or Postgres (Nitro `useDatabase`)
- Streaming bridge uses WebSocket (preferred) and optionally SSE for environments without WS.
- SSR-safe: server-only code guarded with `import.meta.server`.


## 3) Module Options (nuxt.config.ts)

```ts
export default defineNuxtConfig({
  modules: [
    // ...,
    'nuxt-queue',
  ],
  queue: {
    // Worker discovery (provider-native registration)
    workers: {
      dir: 'server/worker', // relative to Nuxt source dir
      // detection by file ending
      tsExtensions: ['.ts', '.js', '.mjs', '.cjs'],
      pyExtensions: ['.py'],
      // queue name strategy: 'filename' | 'directory' | 'export'
      queueNameFrom: 'export',
      // when 'export', read `export const queue = 'name'` or `export const config = { queue: 'name' }`
      defaultQueueNameStrategy: 'filename'
    },
    // Queue Provider
    provider: {
      name: 'bullmq' | 'pgboss',
      options: {
        // Forwarded to underlying client (validated via zod schema)
      }
    },

    // Logger Provider
    logger: {
      name: 'bullmq' | 'pgboss' | 'console',
      level: 'debug' | 'info' | 'warn' | 'error',
      options: {}
    },

    // State Provider
    state: {
      name: 'redis' | 'postgres',
      namespace: 'nq',
      options: {
        // For redis: unstorage driver opts
        // For postgres: useDatabase config key
      }
    },

    // Event Store (append-only streams, Motia-inspired)
    eventStore: {
      name: 'redis' | 'postgres' | 'memory',
      options: {
        // redis: XADD/XREAD options or fall back to unstorage append
        // postgres: table name, NOTIFY channel names, listen timeouts
      },
      // naming convention for streams
      streams: {
        global: 'nq:events',
        job: (jobId: string) => `nq:job:${jobId}`,
        queue: (queue: string) => `nq:queue:${queue}`,
        flow: (flowId: string) => `nq:flow:${flowId}`
      },
      retention?: { maxDays?: number; maxEvents?: number },
      projections?: { snapshot?: { intervalEvents?: number; intervalMs?: number } }
    },

    // Runtimes
    runtimes: {
      typescript: {
        enabled: true,
        // Execution mode for TS workers
        isolate: 'task' | 'inprocess',
        // Task-mode configuration
        task?: {
          name?: string // default: '_job:runner'
          // resolved during module setup: resolver.resolve(runtimeDir, 'jobtask')
          handler?: string
          // run task by spawning a child process (nitro CLI) instead of in-proc task
          spawn?: boolean // default: false
          // command template used when spawn=true
          // e.g. 'nitro task run {name} --payload {payloadJSON}'
          spawnCommand?: string,
          resourceHints?: { memoryMb?: number; cpuShares?: number }
        }
      },
      python: {
        enabled: false,
        // command to run python, venv path optional
        cmd: 'python3',
        env: {},
        // python import mode: 'module' uses module path resolution; 'file' runs by file path
        importMode: 'file',
        process?: { timeoutMs?: number; maxRssMb?: number; envAllowlist?: string[] }
      }
    },

    // Streaming
    streaming: {
      transport: 'ws' | 'sse',
      heartbeatMs: 15000,
      bufferLimit: 1_000_000, // backpressure
    },

    // Security / Auth
    api?: { auth?: { requireRole?: string[]; allowInDev?: boolean } },
    ws?: { auth?: { requireRole?: string[]; allowInDev?: boolean } },

    // Multitenancy
    tenancy?: { namespaceFrom?: string | ((req: any) => string) },

    // Artifact / Blob provider for large payloads/results
    blob?: { provider: 'memory' | 'fs' | 's3' | 'gcs'; basePath?: string; bucket?: string; signedUrl?: boolean }
  }
})
```

Notes:
- Auto-imports are disabled, so the module will expose explicit entry points. Consumers must import from `#imports` or direct paths provided by the module.
- All server-only options are resolved in `import.meta.server` branches.
 - Worker discovery is opinionated: all worker functions live under `server/worker/**`, TS/JS vs Python determined by file extension.
 - A small helper `defineQueueConfig` is exposed to provide intellisense and validation for worker configs in TS.


## 4) Provider Abstractions

### 4.1 QueueProvider

Contract:
- init(): Promise<void>
- enqueue(queue: string, job: JobInput): Promise<JobId>
- schedule(queue: string, job: JobInput, opts: { delay?: number, cron?: string }): Promise<JobId>
- getJob(queue: string, id: string): Promise<Job | null>
- getJobs(queue: string, filters: JobsQuery): Promise<Job[]>
- on(queue: string, event: QueueEvent, cb: (evt: QueueEventPayload) => void): Unsubscribe
- pause(queue: string): Promise<void>
- resume(queue: string): Promise<void>
- close(): Promise<void>

Implementation mapping:
- BullMQProvider: wraps `Queue`, `QueueEvents`, reuses and replaces current logic in `src/runtime/server/utils/useQueue.ts` under the new provider.
- PgBossProvider: wraps `pg-boss` (enqueue, schedule via `schedule`, events via `onComplete`/`onFail` with an internal dispatcher).

Operational controls mapping:
- Concurrency: set on Worker (BullMQ) and `work()` options (PgBoss) where supported.
- Rate limits: BullMQ rate limiting options; emulate with a token bucket if not native.
- Retries/DLQ: map `attempts/backoff` (BullMQ) and retry/expire (PgBoss); create `<queue>-dlq` automatically if enabled and route failures.

Compatibility:
- Preserve current REST/WS endpoints under `src/runtime/server/api/_queue/**` by routing them to the new provider façade.

Worker start semantics (critical requirement):
- Workers are registered using the provider-native APIs:
  - BullMQ: `new Worker(queueName, handler, options)`
  - PgBoss: `boss.work(queueName, handler, options)`
- Our module will install workers discovered in `server/worker/**` at Nitro startup, binding each discovered handler to the provider.

### 4.2 LoggerProvider

Contract:
- log(level, msg, meta?)
- child(bindings)
- levels: debug/info/warn/error

Implementations:
- BullMqLogger: reuse `consola` tagged logger + hook BullMQ events/log entries when available.
- PgBossLogger: thin wrapper around `consola` with the same surface, optionally intercepting PgBoss events. Since PgBoss lacks logger, we standardize via our provider.
 - Redaction: support a redact list of JSON paths to mask sensitive fields before writing.

Exposure:
- Provide a `useQueueLogger()` server util returning the provider instance.

### 4.3 StateProvider

Contract:
- get<T>(key: string): Promise<T | null>
- set<T>(key: string, value: T, opts?: { ttl?: number }): Promise<void>
- delete(key: string): Promise<void>
- list(prefix: string, opts?: { limit?: number }): Promise<{ keys: string[] }>
- patch<T>(key: string, updater: (prev: T | null) => T, opts?): Promise<T>  // optimistic w/ retry

Implementations:
- RedisState: Nitro `useStorage('redis')` via unstorage; namespace-aware keys.
- PostgresState: Nitro `useDatabase('default')` (configurable key); a simple `states` table schema with `key TEXT PRIMARY KEY, value JSONB, ttl TIMESTAMP NULL` plus periodic cleanup.

Notes:
- All state keys are namespaced: `${namespace}:${flowId}:${step}` to support composable flows later.
- If `useDatabase` is unavailable, we’ll gate it behind a feature flag and document version requirements.


## 5) Worker Discovery & Provider-native Registration

Overview:
- The module scans `<srcDir>/server/worker/**` at build/init time (Nitro hooks) and resolves worker files by ending:
  - TS/JS worker: extensions in `workers.tsExtensions`
  - Python worker: extensions in `workers.pyExtensions`
- Queue name resolution:
  1) If the module exports `queue` or `config.queue`, use that.
  2) Otherwise use `defaultQueueNameStrategy`:
     - `filename`: kebab-case of file name without extension
     - `directory`: directory name under `server/worker`
- Registration uses provider-native worker APIs (BullMQ Worker, PgBoss work).

Worker function contract (TS/JS):
```ts
// server/worker/image/resize.ts
export const queue = 'image-resize' // optional; else derived

export interface WorkerInput { url: string; width: number }

export default async function handle(input: WorkerInput, ctx: RunContext) {
  ctx.emit({ type: 'log', data: 'Starting resize' })
  // ... work ...
  ctx.emit({ type: 'progress', data: 50 })
  return { ok: true, result: { url: '...' } }
}
```

Worker function contract (Python):
```py
# server/worker/image/resize.py
queue = 'image-resize'  # optional; else derived

def handle(input, ctx):
    ctx.emit({ 'type': 'log', 'data': 'Starting resize' })
    # ... work ...
    ctx.emit({ 'type': 'progress', 'data': 50 })
    return { 'ok': True, 'result': { 'url': '...' } }
```

Notes:
- Python handlers are executed via a spawned process per job (Phase 1), with optional pooling in later phases.
- Both TS and Python handlers receive the same logical `ctx` (logger/state/emit) implemented via adapters.
- Job payload mapping for provider:
  - BullMQ handler signature bridges to `(job) => handle(job.data, ctx)`
  - PgBoss handler signature bridges to `(job) => handle(job.data, ctx)`

Implementation detail: WorkerAdapter
- A small adapter that binds discovered handlers to the active `QueueProvider`:
  - `registerTsWorker(queueName, filePath, exportName?)`
  - `registerPyWorker(queueName, filePath)`
- The adapter uses the Runner (see next section) to execute handlers, but creation/start of workers strictly uses provider-native APIs.


## 6) Runner Abstractions

### 5.1 Runner types

Common Contract (`Runner`):
- run(funcRef: FuncRef, input: unknown, ctx: RunContext, stream?: StreamSink): Promise<RunResult>
- dispose(): Promise<void>

Where:
- `FuncRef` = { kind: 'ts' | 'py', name: string, module?: string }
- `RunContext` includes: jobId?, queueName?, state: StateProvider, logger: LoggerProvider, emit(event)
- `StreamSink` is an adapter to push stream frames to the streaming bridge.

### 6.2 TypeScript Runner

Modes:
- inprocess: direct dynamic-import of the worker module and call exported handler; shares app state/context.
- task: execute via Nitro tasks to improve isolation and hot-reload ergonomics.

Task registration (module setup):
```ts
nuxt.options.nitro.tasks = {
  ...nuxt.options.nitro.tasks,
  [taskName]: {
    handler: resolver.resolve(runtimeDir, 'jobtask')
  }
}
```

Job execution in task-mode:
- In-proc task: call Nitro task programmatically with payload `{ filePath, exportName?, input, meta }`.
- Spawned: run CLI: `nitro task run <name> --payload '{...}'` and capture stdout JSON for frames/result.

Module resolution: dynamic import by module path inside the task handler; call the exported function by name.

Streaming: within tasks, frames are sent to parent via IPC-style stdout JSONL or in-proc bridge depending on spawn mode. The bridge forwards to Event Store and WS/SSE.

Dev reload: use Nuxt builder watch to detect changes under `server/worker/**` and re-register provider workers and ensure task handler imports pick up HMR recompiles, following techniques similar to gsxdsm/nuxt-job-queue.

Error handling: serialize errors with code/stack; surface via stream and job failure event. Honor `timeoutMs` and emit `job.cancelled` on timeout/cancel.

### 6.3 Python Runner

- Spawn a long-lived child process (optional pool) or per-invocation process.
- IPC protocol: JSON Lines over stdio.
  - request: { id, type: 'run', name, module, input, contextMinimal }
  - response stream frames: { id, type: 'log'|'progress'|'partial'|'result'|'error', data }
- Provide a tiny helper python module (optional) to emit frames.
- Process lifecycle: health checks, heartbeat; restart on crash.
 - Enforce resource constraints (timeout/maxRss) best-effort; kill on overage and emit `job.cancelled`.


## 7) Event Stream Architecture (Motia-inspired)

Rationale:
- Replace functional event wiring with an append-only event stream approach inspired by Motia.
- Unify all signals (job lifecycle, progress, logs, partials, custom domain events) into durable streams.

Concepts:
- Event: immutable record `{ id, ts, kind, subject, source, data, meta, correlationId, causationId, v }`.
- Event Store Provider: append, read (tail/paginate), and subscribe.
- Event Bus: in-process pub/sub that mirrors appended events to WS/SSE and drives projections.
- Projections: reduce streams into state snapshots (stored via StateProvider), e.g., job status or flow state.

Contracts:
- Streams
  - Global stream for all events
  - Per-queue streams
  - Per-job streams
  - Per-flow streams
- Ordering: best-effort total order per stream; cross-stream causal links via correlation/causation IDs.

Provider implementations:
- Redis:
  - Preferred: Redis Streams (XADD/XREAD/XGROUP).
  - Fallback: unstorage append log with monotonic IDs.
- Postgres:
  - `events` table: `id BIGSERIAL, stream TEXT, ts TIMESTAMPTZ, kind TEXT, subject TEXT, data JSONB, meta JSONB, correlation_id TEXT, causation_id TEXT, v INT`.
  - LISTEN/NOTIFY on `events_new` for live tails; poll fallback.

Event schemas:
- Validate with zod; version via `v` field.
- Core kinds: `job.added`, `job.active`, `job.progress`, `job.completed`, `job.failed`, `job.cancelled`, `worker.log`, `runner.partial`, `flow.state.updated`, `flow.cancelled`, `schema.error`, `buffer.drop`.

API exposure:
- `useEventStore()` server util for append/read/subscribe.
- `createEventStream()` client util to subscribe to WS/SSE streams with filters.

Interplay with Queue/Runner:
- QueueProvider events are normalized and appended to streams (global + queue + job streams).
- Runner `ctx.emit` turns into event appends (e.g., logs/progress) and mirrored to WS/SSE.
- Projections update StateProvider snapshots; UI consumes snapshots for fast loads, streams for live updates.


## 8) Flow Architecture (Motia-inspired)

Goal:
- Let developers write normal workers or mark them as part of a Flow. A Flow has one `main` function and optional `steps` that subscribe to events and share state. This mirrors Motia’s config-driven flow approach using streams.

Flow configuration (TS/JS):
Recommended TypeScript helper for typings: `defineQueueConfig` (exposed via `#imports`)
```ts
import { defineQueueConfig } from '#imports'
```
Simple form (main step):
```ts
// server/worker/image/resize.ts
export const queue = 'image-resize'
export const config = defineQueueConfig({
  flow: {
    id: 'image-pipeline',
    role: 'main',           // 'main' | 'step'
    step: 'resize',         // logical step name
    emits: ['resize.requested','resize.progress','resize.completed','resize.failed']
  }
})

export default async function handle(input, ctx) {
  const corr = ctx.correlationId()
  ctx.emit({ kind: 'resize.requested', data: { url: input.url }, correlationId: corr })
  // work...
  ctx.emit({ kind: 'resize.progress', data: { pct: 50 }, correlationId: corr })
  // done
  ctx.emit({ kind: 'resize.completed', data: { url: '...' }, correlationId: corr })
  return { ok: true }
}
```

```ts
// server/worker/image/thumbnail.ts
import { defineQueueConfig } from '#imports'

export const queue = 'image-thumbnail'
export const config = defineQueueConfig({
  flow: {
    id: 'image-pipeline',
    role: 'step',
    step: 'thumbnail',
    // triggers DSL (simplified): listen to events and enqueue this step
    // Defaults: from='flow', input=event.data, jobId=`${corr}:${step}` for idempotency
    triggers: 'resize.completed'
  }
})

export default async function handle(input, ctx) {
  const corr = ctx.correlationId()
  const thumb = await makeThumb(input.url)
  ctx.state.set(['thumb', corr], { url: thumb })
  ctx.emit({ kind: 'thumbnail.completed', data: { url: thumb }, correlationId: corr })
  return { ok: true }
}
```

Flow configuration (Python):
```py
# server/worker/image/resize.py
queue = 'image-resize'
config = {
  'flow': {
    'id': 'image-pipeline',
    'role': 'main',
    'step': 'resize',
    'emits': ['resize.requested','resize.progress','resize.completed','resize.failed']
  }
}

def handle(input, ctx):
    corr = ctx.correlation_id()
    ctx.emit({ 'kind': 'resize.requested', 'data': { 'url': input['url'] }, 'correlationId': corr })
    # work...
    ctx.emit({ 'kind': 'resize.completed', 'data': { 'url': '...' }, 'correlationId': corr })
    return { 'ok': True }
```

Concepts:
- Flow id: logical pipeline id; multiple runs are correlated via `correlationId` (defaults to main jobId or provided).
- Main step: consumed from queue; emits events to event store; seeds shared state.
- Steps: subscribe to flow streams by filters and enqueue themselves on matching events using `map(event) -> { data, opts }`.
- State: StateProvider keys composed as `${namespace}:flow:${flowId}:${correlationId}:${step}`. Steps may read/write.
 - Versioning: `flow.version` (optional) freezes trigger behavior for a run to avoid drift during deploys.

FlowEngine:
- At startup, compiles discovered worker configs:
  - Registers provider-native workers (as before).
  - For `role=step` with `triggers`, subscribes to events via EventStoreProvider using defaults:
    - from stream: flow stream for correlationId (by default)
    - map input: `event.data`
    - jobId: `${correlationId}:${step}` (idempotent)
  - On matching events, enqueues a job to the step queue; advanced mapping can be configured if needed.
- Ensures idempotency: derive deterministic jobId (e.g., `${correlationId}:${step}`) when appropriate.
- Handles retry/backoff and dedupe flags from `map(event).opts`.

Correlation and causation:
- The `ctx.correlationId()` remains constant across steps; `causationId` points to event/job that triggered the current step.
- Projections can group all events by correlationId to build flow timelines.

Developer experience:
- Normal workers work unchanged (no `config.flow`).
- Adding `config.flow` turns a worker into a flow main/step.
- Triggers are declarative and concise; advanced mapping is optional and can be provided when defaults aren’t sufficient.
 - Compensation: optionally declare compensating steps to run on failures.


## 9) Streaming Model

Transport priority: WebSocket (existing `crossws` in repo) with SSE fallback.

- Channel namespace: `/api/_queue/ws` (existing), plus `/api/_runner/ws` for general runner streams.
- Message envelope:
```json
{
  "v": 1,
  "stream": "job|runner",
  "event": "started|progress|log|partial|completed|failed",
  "jobId": "...",
  "queue": "...",
  "data": {}
}
```
- Backpressure: server buffers per-peer up to `bufferLimit`; drop oldest with a `buffer_drop` diagnostic event.
- Auth: pluggable predicate; default allow in dev.

Client utilities (explicit imports):
- `import { createQueueStream } from '#imports'` returns a minimal client that connects, subscribes by queue/job.
 - `import { createEventStream } from '#imports'` to subscribe directly to event streams with selectors.


## 10) Server Endpoints and Composables

Reuse and extend current endpoints under `src/runtime/server/api/_queue/**`:
- Route queue operations to the QueueProvider façade.
- Introduce runner endpoints: `/api/_runner/execute` (server-only), `/api/_runner/ws`.
 - Event endpoints:
   - `/api/_events/ws` (WS multiplexed by stream id / filters)
   - `/api/_events/[stream].get` for paginated fetch and `/api/_events/[stream]/tail` for tailing (SSE fallback)
 - Flow endpoints:
   - `/api/_flow/index.get` list flows and steps
   - `/api/_flow/[id]/runs.get` list recent runs (by correlationId)
   - `/api/_flow/[id]/runs/[corr].get` fetch timeline (events + snapshot)
    - `/api/_flow/[id]/runs/[corr]/cancel.post` request cancellation (emit `flow.cancelled` and propagate)
  - Metrics endpoint (optional): `/api/_metrics` exposes Prometheus format counters/histograms.

Composables (no auto-imports):
- `import { useQueue } from 'nuxt-queue/runtime'` (server-only APIs)
- `import { useQueueSubscription } from 'nuxt-queue/runtime'` (client)
- `import { useRunner } from 'nuxt-queue/runtime'` (server)

Note: Keep the existing names where possible and alias to new implementations.


## 11) Runtime configuration and registry (private)

Why:
- Persist a compiled, serializable registry of providers, workers, queues, and flows in Nuxt private runtime config for predictable server boot and tooling.

Where:
- Stored under `runtimeConfig.queue.registry` (server-only). No functions are serialized; only JSON-safe descriptors. Advanced handlers are referenced by file/export to hydrate at runtime.

Schema (JSON-safe):
```ts
interface QueueRegistryProvider {
  name: 'bullmq' | 'pgboss'
  options?: Record<string, any> // sanitized (no secrets if public)
}

interface StateRegistryProvider { name: 'redis' | 'postgres'; namespace: string }
interface LoggerRegistryProvider { name: 'bullmq' | 'pgboss' | 'console'; level: string }
interface EventStoreRegistryProvider { name: 'redis' | 'postgres' | 'memory' }

interface RegisteredWorker {
  id: string // stable id, e.g., relative path without ext
  kind: 'ts' | 'py'
  filePath: string
  exportName?: string // 'default' for TS default export
  queue: string
  flow?: {
    id: string
    role: 'main' | 'step'
    step: string
    emits?: string[]
    triggers?: string[] // simplified DSL compiled to array
    // advanced subscriptions not serialized as functions; instead provide resolver reference
    subscriptionsRef?: { filePath: string; exportName?: string }
  }
}

interface RegisteredFlowIndex {
  [flowId: string]: {
    main?: { step: string; queue: string; workerId: string }
    steps: Record<string, { queue: string; workerId: string; triggers?: string[] }>
  }
}

interface EventToStepIndex {
  // event kind -> list of target steps across flows
  [eventKind: string]: Array<{ flowId: string; step: string; queue: string; workerId: string }>
}

interface RegistryRunnerConfig {
  ts: { isolate: 'inprocess' | 'task'; task?: { name: string; handler?: string; spawn?: boolean; spawnCommand?: string } }
  py: { enabled: boolean; cmd: string; importMode: 'file' | 'module' }
}

interface QueueModuleRegistry {
  version: number
  compiledAt: string
  provider: QueueRegistryProvider
  logger: LoggerRegistryProvider
  state: StateRegistryProvider
  eventStore: EventStoreRegistryProvider
  runner: RegistryRunnerConfig
  workers: RegisteredWorker[]
  flows: RegisteredFlowIndex
  eventIndex: EventToStepIndex
  blob?: { provider: string; basePath?: string; bucket?: string; signedUrl?: boolean }
}
```

Example stored object:
```json
{
  "version": 1,
  "compiledAt": "2025-10-18T12:34:56.000Z",
  "provider": { "name": "bullmq" },
  "logger": { "name": "console", "level": "info" },
  "state": { "name": "redis", "namespace": "nq" },
  "eventStore": { "name": "redis" },
  "runner": { "ts": { "isolate": "inprocess" }, "py": { "enabled": false, "cmd": "python3", "importMode": "file" } },
  "workers": [
    { "id": "image/resize", "kind": "ts", "filePath": "server/worker/image/resize.ts", "exportName": "default", "queue": "image-resize", "flow": { "id": "image-pipeline", "role": "main", "step": "resize", "emits": ["resize.requested","resize.progress","resize.completed","resize.failed"] } },
    { "id": "image/thumbnail", "kind": "ts", "filePath": "server/worker/image/thumbnail.ts", "exportName": "default", "queue": "image-thumbnail", "flow": { "id": "image-pipeline", "role": "step", "step": "thumbnail", "triggers": ["resize.completed"] } }
  ],
  "flows": {
    "image-pipeline": {
      "main": { "step": "resize", "queue": "image-resize", "workerId": "image/resize" },
      "steps": {
        "thumbnail": { "queue": "image-thumbnail", "workerId": "image/thumbnail", "triggers": ["resize.completed"] }
      }
    }
  },
  "eventIndex": {
    "resize.completed": [ { "flowId": "image-pipeline", "step": "thumbnail", "queue": "image-thumbnail", "workerId": "image/thumbnail" } ]
  }
}
```

When and how it’s written:
- During module setup, we collect static discovery (file paths, queue names from exports, triggers). We sanitize and build a JSON-safe registry.
- Use `nitro:config` hook to inject the registry into `nitro.runtimeConfig.queue.registry` so it’s embedded in the server bundle and available at runtime.

Sketch (module side):
```ts
// inside module setup
nuxt.hook('nitro:config', (nitro) => {
  const base = nitro.runtimeConfig.queue || {}
  nitro.runtimeConfig.queue = {
    ...base,
    registry: compiledRegistry // QueueModuleRegistry
  }
})
```

Runtime usage:
- At server boot, FlowEngine and WorkerAdapter read `useRuntimeConfig().queue.registry` to rehydrate subscriptions and register provider-native workers without re-scanning the filesystem.
- In dev/watch, we rebuild the in-memory registry on changes and update FlowEngine; runtimeConfig remains the last compiled snapshot, plus a `version`/`compiledAt` to detect drift.
 - Observability: expose registry version/compiledAt in `/api/_metrics` labels for correlation.

Security:
- Keep secrets out of the registry; only store sanitized provider options or references. Queue credentials remain in private runtime config fields outside `registry`.


## 12) SSR and Safety

- Guard server-only modules with `import.meta.server`.
- Ensure Python spawns only on server; TS runner `inprocess` respects SSR.
- Graceful shutdown hooks to close providers and child processes on Nitro close.


## 13) Mapping to Current Codebase

- `src/runtime/server/utils/useQueue.ts`: becomes BullMQ provider implementation. Extract events wiring to a provider class; keep `crossws` peer management in the streaming layer. Add WorkerAdapter that uses BullMQ `Worker`.
- `src/runtime/server/api/_queue/**`: rewire to provider façade; keep route signatures stable.
- `src/runtime/handlers/defineQueueWorker.ts`: adapt to Worker discovery metadata (exported `queue`/`config`). Provide helper for TS workers to define metadata if needed.
- `src/runtime/plugins/queue.ts` and `src/runtime/composables/useQueueSubscription.ts`: point to streaming bridge and provider façade.
 - New: a Nitro hook (e.g., `nitro:init` or module `setup`) scans `server/worker/**` and registers workers provider-natively.
 - New: `src/runtime/server/utils/useEventStore.ts` and `EventBus` (in-process) to abstract append/read/subscribe and multiplex to WS.
 - New: projections folder `src/runtime/server/projections/**` to reduce event streams into StateProvider snapshots (job, queue, flow).
 - New: `src/runtime/server/flow/engine.ts` to implement FlowEngine, compile configs, and register subscriptions/triggers.
 - New: `src/runtime/server/metrics/` to expose Prometheus metrics; wire counters in providers/runners/engine.
 - New: `src/runtime/server/blob/` to abstract BlobProvider (fs/memory placeholder first).


## 14) Types and Minimal Interfaces

```ts
// queue
export type QueueEvent = 'added' | 'active' | 'progress' | 'completed' | 'failed';
export interface JobInput { name: string; data: any; opts?: Record<string, any> }
export interface Job { id: string; name: string; data: any; state: 'waiting'|'active'|'completed'|'failed'; progress?: number; result?: any; error?: any }
export interface JobsQuery { state?: Job['state'][]; limit?: number; cursor?: string }

export interface QueueProvider {
  init(): Promise<void>
  enqueue(queue: string, job: JobInput): Promise<string>
  schedule(queue: string, job: JobInput, opts?: { delay?: number; cron?: string }): Promise<string>
  getJob(queue: string, id: string): Promise<Job|null>
  getJobs(queue: string, q?: JobsQuery): Promise<Job[]>
  on(queue: string, event: QueueEvent, cb: (p: any) => void): () => void
  pause(queue: string): Promise<void>
  resume(queue: string): Promise<void>
  close(): Promise<void>
}

// logger
export type LogLevel = 'debug'|'info'|'warn'|'error'
export interface LoggerProvider { log(level: LogLevel, msg: string, meta?: any): void; child(bindings: any): LoggerProvider }

// state
export interface StateProvider {
  get<T=any>(key: string): Promise<T|null>
  set<T=any>(key: string, val: T, opts?: { ttl?: number }): Promise<void>
  delete(key: string): Promise<void>
  list(prefix: string, opts?: { limit?: number }): Promise<{ keys: string[] }>
  patch<T=any>(key: string, updater: (prev: T|null)=>T, opts?: { retries?: number }): Promise<T>
}

// runner
export interface Runner {
  run(funcRef: { kind: 'ts'|'py'; name: string; module?: string }, input: unknown, ctx: RunContext, stream?: StreamSink): Promise<{ ok: true; result: any } | { ok: false; error: any }>
  dispose(): Promise<void>
}
export interface RunContext { jobId?: string; queue?: string; state: StateProvider; logger: LoggerProvider; emit: (evt: any)=>void }
export interface StreamSink { send(frame: any): void; close(code?: number): void }

// worker adapter (new)
export interface WorkerAdapter {
  registerTsWorker(queueName: string, filePath: string, exportName?: string): Promise<void>
  registerPyWorker(queueName: string, filePath: string): Promise<void>
}

// event store
export interface EventRecord<T=any> {
  id: string
  stream: string
  ts: string
  kind: string
  subject?: string
  data: T
  meta?: any
  correlationId?: string
  causationId?: string
  v?: number
}

export interface EventReadOptions {
  fromId?: string // exclusive
  limit?: number
  direction?: 'forward'|'backward'
}

export interface EventSubscription {
  unsubscribe(): void
}

export interface EventStoreProvider {
  append<T=any>(stream: string, event: Omit<EventRecord<T>, 'id'|'ts'|'stream'>): Promise<EventRecord<T>>
  read(stream: string, opts?: EventReadOptions): Promise<EventRecord[]>
  subscribe(stream: string, onEvent: (e: EventRecord) => void): Promise<EventSubscription>
  close(): Promise<void>
}

export interface EventBus {
  publish<T=any>(event: EventRecord<T>): void
  on(kind: string, handler: (e: EventRecord) => void): () => void
}

// flow
export type FlowRole = 'main' | 'step'
export interface EventPattern { kind?: string | string[]; where?: (e: EventRecord) => boolean }
export interface TriggerMapResult { data: any; opts?: { jobId?: string; delay?: number; priority?: number; attempts?: number; dedupe?: boolean } }
export interface SubscriptionRule {
  stream: string | ((flowId: string, corrId?: string) => string)
  when?: EventPattern
  map: (event: EventRecord) => TriggerMapResult
}
export interface FlowConfig {
  id: string
  role: FlowRole
  step: string
  emits?: string[]
  version?: string
  // simplified DSL: one or many event kinds from the flow stream
  triggers?: string | string[]
  // advanced: full control
  subscriptions?: SubscriptionRule[]
  compensation?: { step: string; on: string | string[] }
}
export interface WorkerConfig {
  queue?: string
  flow?: FlowConfig
  // operational controls
  concurrency?: number
  rateLimit?: { max: number; durationMs: number }
  retryPolicy?: { attempts: number; backoff?: { type: 'fixed'|'exponential'; delayMs: number }; onFail?: 'retry'|'dlq'|'drop' }
  dlq?: { enabled?: boolean; queue?: string }
  timeoutMs?: number
  idempotencyKey?: 'auto' | ((input: any) => string)
  // validation schemas (zod-like)
  inputSchema?: any
  outputSchema?: any
}
export type DefineQueueConfig = (cfg: WorkerConfig) => WorkerConfig
export interface FlowEngine {
  register(configs: Record<string, WorkerConfig>): Promise<void>
  close(): Promise<void>
}

// blob provider
export interface BlobProvider {
  put(key: string, data: Uint8Array | ReadableStream | Buffer, opts?: any): Promise<{ key: string; url?: string }>
  get(key: string): Promise<Uint8Array | ReadableStream | Buffer>
  delete(key: string): Promise<void>
}
```


## 15) Implementation Plan (Phased)

Phase 1: Provider façade + BullMQ mapping
- Extract `BullMQProvider` from `useQueue.ts` and rewire server APIs.
- Introduce `QueueProvider` interface and minimal `ProviderRegistry`.
- Add `LoggerProvider` with consola-backed impls (bullmq/pgboss-compatible surface).
- Keep current WS streaming; refactor peer management behind `StreamingBridge`.
 - Add Worker discovery for TS; register workers via BullMQ `Worker` using `TsRunner`.

Phase 2: State provider
- Add `RedisState` using Nitro `useStorage` and namespacing.
- Add `PostgresState` using Nitro `useDatabase` with a small migration for `states` table.
- Provide `useWorkerState(flowId)` helper returning CRUD operations with namespaced keys.

Phase 2b: Event store provider + bus + projections
- Implement `EventStoreProvider` for Redis (streams) and Postgres (table + NOTIFY).
- Add in-process `EventBus` that emits to WS/SSE.
- Append normalized queue events and runner ctx emits to streams (global, queue, job, flow).
- Implement minimal projections: job status timeline -> snapshot; queue stats counters.

Phase 3b: Flow Engine & Triggers
- Implement `FlowEngine` to compile worker configs and set up subscriptions.
- For each subscription rule, subscribe to streams and enqueue step jobs via QueueProvider using map() output.
- Add flow endpoints to list flows and retrieve runs/timelines.

Phase 3: TS Runner
- Implement `TsRunner` (inprocess; optional worker_threads behind flag).
- Add `/api/_runner/execute` server endpoint.
- Hook streams to WS bridge; emit progress/log frames from TS functions via `ctx.emit`.
 - Finalize TS WorkerAdapter for BullMQ and PgBoss registrations.

Phase 4: PgBoss queue provider
- Implement `PgBossProvider`; map events to common `QueueEvent`s.
- Add config schema, docs, tests.
 - Implement Worker discovery registration via `boss.work`.

Phase 5: Python Runner (basic)
- Implement stdio JSONL protocol; single-process-per-run basic mode.
- Provide small Python helper lib to emit frames (shipped as text asset; optional pip package later).
 - Wire Python workers discovered in `server/worker/**` via provider-native registration (BullMQ Worker handler spawns Python, PgBoss work handler spawns Python).

Phase 6: SSE fallback + polish
- SSE endpoints; client util chooses WS or SSE by feature detection.


## 16) Testing & Acceptance Criteria

- Unit tests for provider interfaces (mocked backends).
- Integration tests for BullMQ provider (existing Redis setup via `compose.yml`).
- Integration tests for PgBoss with a disposable Postgres.
- Runner tests: TS runner happy path + error + progress streaming.
- E2E sample in `playground` with both providers.

Acceptance Criteria:
- Can enqueue a job with BullMQ and receive progress/completion over WS.
- Can switch to PgBoss via config with no code changes in API consumers.
- Can persist state in Redis and fetch it within another job run.
- TS runner can emit stream frames and complete with a result.
- Python runner (basic) can execute a function and stream logs.
 - Workers under `server/worker/**` are auto-registered provider-natively (BullMQ Worker, PgBoss work) and execute with the same `ctx` across TS and Python.
 - Event Store persists all core events; can tail a per-job stream and replay; projections generate consistent snapshots.
 - Define a simple flow (main resize, step thumbnail); on `resize.completed`, a `thumbnail` job is enqueued automatically; state is shared and accessible; works under BullMQ and PgBoss.
 - `defineQueueConfig` helper provides correct typings; the simplified `triggers` DSL works out of the box with default mapping.
 - Idempotency key prevents duplicate enqueue for the same input.
 - Timeout cancels long-running jobs and emits `job.cancelled`; flow cancellation endpoint emits `flow.cancelled` and stops downstream triggers.
 - DLQ behavior routes exhausted retries to `<queue>-dlq` and can be observed via metrics and events.
 - Metrics endpoint exposes basic counters/histograms; logs/events redact configured fields.
 - Blob provider supports a large payload/result roundtrip with a stored artifact reference.


## 17) Migration Notes

- Existing imports like `useQueue` will continue to work but internally delegate to `QueueProvider` (BullMQ by default). No breaking changes to REST endpoints.
- `useQueue.ts` event peer management will be moved into `StreamingBridge`; code using `addListener/removeListener` will map to bridge APIs.
 - Place existing workers (if any) under `server/worker/**` and export `queue` (or `config.queue`) or rely on filename to derive queue names.
 - Functional event hooks should be replaced by appending to the Event Store. Where needed, provide compatibility shims that translate old hooks to stream appends.
 - Workers can opt-in to flows by adding `export const config = { flow: { ... } }` (TS/JS) or `config = { 'flow': { ... } }` (Python). No changes needed for single workers.


## 18) Open Questions

- Do we need job concurrency control at the runner layer or rely on the queue backend only?
- How to authenticate WS/SSE in production (Nuxt auth integration)?
- Python packaging: provide a local helper module vs. published package.
- Long-running Python worker pool vs. per-invocation model (phase 1 opts for per-invocation).
 - For multi-export modules, should we allow multiple handlers per file (e.g., named exports) and derive multiple queues? Default is one default export per file.
 - Exactly-once vs at-least-once semantics for event processing and projections; idempotent reducers recommended.
 - Stream compaction/retention strategy and snapshot frequency.
 - Python flow config discovery: should we support sidecar `.flow.json` next to `.py` files for richer configs?


## 19) Docs & DX

- Update README with provider config examples and runner usage.
- Provide minimal code templates under `src/templates.ts` for common worker patterns.
- Include a playground example toggling between BullMQ and PgBoss via env.
 - Document event schemas, stream naming, and example reducers/projections.
 - Provide flow config examples (TS and Python) and recommended patterns for mapping and idempotency.
