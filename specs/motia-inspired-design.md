# Nuxt Queue: Unified Queue | Flow | Call Architecture (Motia-inspired)

Status: Draft
Owner: DevJoghurt
Last updated: 2025-10-29
Target branch: refactoring

## 1) Motivation and Goals

We evolve nuxt-queue to a unified execution model with three run modes that share the same runtime, providers, and streaming:
- Queue: enqueue and process jobs on a queue backend (BullMQ first, PgBoss later).
- Flow: Motia-inspired, event-driven orchestration with shared state and projections.
- Call: direct execution of TS/JS/Python functions without enqueuing, still streaming logs/progress and appending events.

Goals:
- Single abstraction for TS and Python runtimes.
- Stream-first execution model (progress, logs, partials) across all modes.
- Pluggable providers (queue, logger, state, event store, blob).
- Nuxt-native DX with SSR safety and explicit imports (auto-imports disabled).
- Registry-driven runtime under `src/registry` to make server boot deterministic (no FS scan at boot in production).

Non-goals (for now):
- Full workflow DSL or visual builder.
- Cross-language packaging beyond basic TS/Python runners.
- Strong multi-tenant isolation or sandboxing guarantees.


## 2) High-level Architecture

```
+-------------------+          +-----------------------+           +-------------------+
|  Client (Vue)     |  WS/SSE  |  Nuxt Server (Nitro)  | Providers |   Backends        |
|  - UI subscribes  +<-------->+  - RunMode Router     +---------->+  Redis / Postgres |
|  - control cmds   |          |  - Runner Orchestr.   |           |  BullMQ / PgBoss  |
+-------------------+          |  - Streaming Bridge   |           +-------------------+
                              |  - Registry (server)  |
                              +-----------------------+
```

- RunMode Router decides at runtime if a process executes as queue, flow, or call (per-process config).
- Runner orchestrator abstracts TS/Python execution, streaming, and context dispatch.
- Providers: Queue, Logger, State, Event Store, Blob.
- Two buses: Internal Bus (in-process, ingress only) and Store Bus (DB-tailed). StreamStore wiring persists streams and does not re-emit canonical on the Internal Bus. Streaming Bridge connects clients (WS/SSE) to the Store Bus.
- Registry (`src/registry`) is compiled at build/setup, consumed at runtime (no cold boot scans).
- SSR-safe: server-only code guarded via `import.meta.server`.


## 3) Module Options (nuxt.config.ts)

```ts
export default defineNuxtConfig({
  modules: ['nuxt-queue'],
  queue: {
    // Discovery (aligned to current repo: server/queues/**)
    workers: {
      dir: 'server/queues',            // relative to Nuxt srcDir per layer
      tsExtensions: ['.ts', '.js', '.mjs', '.cjs'],
      pyExtensions: ['.py'],
      // queue name strategy: 'export' | 'filename' | 'directory'
      queueNameFrom: 'export',
      defaultQueueNameStrategy: 'filename'
    },

    // Default run mode for discovered processes (can be overridden per worker config)
    defaultRunMode: 'queue',           // 'queue' | 'flow' | 'call'

    // Queue Provider
    provider: { name: 'bullmq' | 'pgboss', options: {} },

    // Logger Provider
    logger: { name: 'console' | 'bullmq' | 'pgboss', level: 'info', options: { redact?: [] as string[] } },

    // State Provider
    state: { name: 'redis' | 'postgres', namespace: 'nq', options: {} },

    // Event Store (Motia-like)
    eventStore: {
      name: 'redis' | 'postgres' | 'memory',
      streams: {
        global: 'nq:events',
        job: (jobId: string) => `nq:job:${jobId}`,
        queue: (queue: string) => `nq:queue:${queue}`,
        flow: (flowId: string) => `nq:flow:${flowId}`
      },
      options: {},
      retention?: { maxDays?: number; maxEvents?: number },
      projections?: { snapshot?: { intervalEvents?: number; intervalMs?: number } }
      // Projection stream names (defaults; configurable via runtime config):
      // - Flow snapshot patches:   nq:proj:flow:<flowName>:<flowId>
      // - Per-step patches:        nq:proj:flow-steps:<flowId>
      // - Step log index (per run):nq:proj:flow-step-index:<flowId>
      // - Flow runs index:         nq:proj:flow-runs:<flowName>
    },

    // Runtimes
    runtimes: {
      typescript: {
        enabled: true,
        isolate: 'inprocess' | 'task',
        task?: {
          name?: string,           // default: '_queue:runner'
          handler?: string,        // resolved at build
          spawn?: boolean,         // run CLI subprocess
          spawnCommand?: string,   // e.g. 'nitro task run {name} --payload {payloadJSON}'
          resourceHints?: { memoryMb?: number; cpuShares?: number }
        }
      },
      python: {
        enabled: false,
        cmd: 'python3',
        env: {},
        importMode: 'file' | 'module',
        process?: { timeoutMs?: number; maxRssMb?: number; envAllowlist?: string[] }
      }
    },

    // Streaming
    streaming: { transport: 'ws', heartbeatMs: 15000, bufferLimit: 1_000_000 },

    // Security / Auth
    api?: { auth?: { requireRole?: string[]; allowInDev?: boolean } },
    ws?: { auth?: { requireRole?: string[]; allowInDev?: boolean } },

    // Multitenancy
    tenancy?: { namespaceFrom?: string | ((req: any) => string) },

    // Blob provider
    blob?: { provider: 'memory' | 'fs' | 's3' | 'gcs'; basePath?: string; bucket?: string; signedUrl?: boolean }
  }
})
```

Notes:
- Auto-imports are disabled. Import explicitly from `#imports` or direct module paths.
- Use `import.meta.server` for server-only branches. Python runner is server-only.
- Discovery aligns with current repo: in-process workers under `server/queues/**`.


## 4) Run Modes

- Queue: Provider-native workers (BullMQ/PgBoss). Jobs enqueued via REST/composable, processed by workers. Streams mirror lifecycle.
- Flow: Event-driven orchestration. An “entry” step runs on a queue; steps subscribe to events and enqueue idempotently.
- Call: Direct execution of a handler via Runner (TS/Python), bypassing the queue. Still streams frames and appends events; ideal for RPC-like usage.

Choosing the run mode:
- Per worker via `config.runMode` (see WorkerConfig) or
- Per invocation via `useRunner().call(...)` for call mode.


## 5) Provider Abstractions

QueueProvider (BullMQ now, PgBoss later): enqueue/schedule/get/jobs/events/pause/resume/close. Refactors existing logic in `src/runtime/server/utils/useQueue.ts` behind a façade.

LoggerProvider: consola-backed with optional provider hooks; supports redaction.

StateProvider: Redis (unstorage) and Postgres (useDatabase) with namespacing.

EventStoreProvider: Redis Streams or Postgres table + LISTEN/NOTIFY.

BlobProvider: fs/memory first.


## 6) Process Discovery & Registration

Discovery:
- Recommended folder name: `server/processes` (neutral for queue | flow | call)
  - TS/JS: `<layer.serverDir>/processes/**/*.{ts,js,mjs,cjs}`
  - Python: `<layer.serverDir>/processes/**/*.py`

Name rationale:
- “processes” matches the spec’s core unit (process = worker or callable), unlike “queues,” which implies one run mode. Alternatives considered: `processors`, `tasks`, `actions`. We choose `processes` for clarity and alignment with registry naming.

Queue name resolution:
1) `export const queue = 'name'` or `export const config = { queue: 'name' }`
2) Otherwise `defaultQueueNameStrategy`: filename | directory (directory name under `server/processes`).

Registration:
- Queue mode: register provider-native workers (BullMQ Worker, PgBoss work).
- Flow mode: same for entry/steps; FlowEngine installs triggers.
- Call mode: no worker registration; exposed via runner endpoint/composable.


## 7) Runner Abstractions

Common contract (`Runner`):
- `run(funcRef, input, ctx, stream?) => Promise<Result>` and `dispose()`.

TypeScript Runner:
- inprocess: dynamic import and call export.
- task: Nitro task (optionally spawned via CLI) for isolation and hot reload ergonomics.

Python Runner:
- per-invocation process (phase 1) using JSON Lines over stdio; optional pool later.

Context for all modes:
- `logger`, `state`, `emit(event)`, `jobId?`, `queueName?`, and correlation helpers.

Context details and guarantees:
- logger: leveled logging with child bindings; respects redaction configuration.
- state: namespaced key-value access with atomic patch (optimistic retry); recommended for small/medium state, large artifacts via blob provider.
- emit: appends an event to the configured Event Store and mirrors to WS/SSE; non-blocking best-effort with backpressure diagnostics.
- correlation helpers: `ctx.correlationId()` returns the stable id for a run group; `ctx.causationId()` identifies the triggering event/job.

Frames and streaming contract:
- Frames emitted by runners are normalized to the envelope described in section 10. Core frame types:
  - log: `{ level:'debug|info|warn|error', message, meta? }`
  - progress: `{ pct:number, detail?:any }` (0..100 best-effort)
  - partial: `{ path?:string, value:any }` (for incremental results)
  - result: `{ value:any }` (terminal success)
  - error: `{ name?:string, message:string, stack?:string, code?:string, retriable?:boolean }` (terminal failure)
  - cancelled: `{ reason?:string }` (terminal cancellation)
  - heartbeat: `{ ts:string }` (for liveness in long runs)
  All frames are also persisted as events when `persistFrames=true` (default).

Call mode API:
- `useRunner().call({ kind: 'ts'|'py', module, name }, input, opts?)` executes directly and streams frames.


## 8) Event Stream Architecture (aligned to v0.2 spec)

- Bus message envelope: `{ id, stream, ts, kind, subject?, data?, meta?, v }`.
  - Ingress: published without `id` and `stream` on the Internal Bus.
  - Canonical: persisted records have both `id` and `stream`; canonical delivery happens on the Store Bus.
- Streams: global, per-queue, per-job, per-flow.
- Event store adapters: append/read/subscribe; StreamStore wiring persists canonical records and does not re-emit on the Internal Bus. The Store Bus tails the database and publishes canonical to clients and other nodes.
- Projections (per flow):
  - Flow snapshot patches: `nq:proj:flow:<flowName>:<flowId>`
  - Per-step patches: `nq:proj:flow-steps:<flowId>`
  - Step log index (per run): `nq:proj:flow-step-index:<flowId>` with `data.ref` to the timeline and `data.stepKey`
  - Flow runs index (per flow name): `nq:proj:flow-runs:<flowName>`

Interplay with Queue/Runner:
- Normalize provider events and append (`job.added|active|progress|completed|failed|waiting|cancelled`).
- Runner `ctx.emit` -> publish ingress events (e.g., `runner.log`) via Event Manager on the Internal Bus; StreamStore wiring persists to the flow timeline and projections; the Store Bus delivers canonical to clients and other nodes.

Cancellation and error semantics:
- Cancellation sources: API cancel, timeout, or flow cancel. Providers should attempt cooperative cancellation; runner emits `cancelled` frame and appends `job.cancelled` event.
- Error classification: operational (transient, retriable) vs. programming (permanent). Providers map retries/backoff; `error.retriable===true` hints retry policy.


## 9) Flow Architecture

`config.flow` turns a process into entry or step.

Concepts:
- Flow id; correlationId groups a run (defaults to entry jobId or given).
- Entry emits events; steps subscribe by triggers or advanced subscriptions; enqueue idempotently (jobId `${corr}:${step}`).
- State keys: `${namespace}:flow:${flowId}:${corr}:${step}`.

FlowEngine:
- Compiles configs from registry; subscribes to streams; enqueues steps.
- Idempotency for triggers; retry/backoff/dedupe via mapped opts.
- Version pinning: `flow.version` freezes trigger behavior for a given run; engine records version in run metadata to avoid drift across deploys.


## 10) Streaming Model

- Transport: WS preferred, SSE fallback.
- Endpoints: `/api/_queue/ws` (existing), `/api/_runner/ws`, `/api/_events/ws`.
- Envelope (transport): `{ v:1, stream:'job|runner|flow', event:'started|progress|log|partial|completed|failed|...', jobId?, queue?, data }`.
- Backpressure: per-peer buffer with `buffer.drop` diagnostics.

Security and auth:
- WS/SSE channels accept an auth predicate configured via module options; default allows in dev only.
- Optional JWT/Bearer token validation; recommend scoping subscriptions to queues/users via server policy in handlers.


## 11) Server Endpoints and Composables

Queue endpoints (keep paths under `src/runtime/server/api/_queue/**`): route to QueueProvider façade.

Runner endpoints: `/api/_runner/execute`, `/api/_runner/ws`.

Events: `/api/_events/ws`, `/api/_events/[stream].get`, `/api/_events/[stream]/tail`.

Flow endpoints: `/api/_flow/index.get`, `/api/_flow/[id]/runs.get`, `/api/_flow/[id]/runs/[corr].get`, `/api/_flow/[id]/runs/[corr]/cancel.post`.

Composables (explicit imports, no auto-imports):
- server: `useQueue()`, `useRunner()`, `useStreamStore()`.
 - client: `useQueueSubscription()`, `createEventStream()`.

Explicit imports examples (auto-imports disabled):
- Server: `import { useQueue, useRunner, useStreamStore } from '#imports'`
- Client: `import { useQueueSubscription } from 'nuxt-queue/runtime/app/composables/useQueueSubscription'`


## 12) Runtime Registry (`src/registry`)

Purpose: build a JSON-safe registry at build/setup to drive worker/flow installation and routing in runtime. Stored at `runtimeConfig.queue.registry` (server-only).

Contains:
- Provider/logger/state/eventStore/blob configs (sanitized).
- Runner config (ts/py modes).
- Processes (workers and callables): id, kind, filePath, exportName, queue?, runMode, flow metadata, indices for flows and event->step routing.
- Callable index for call mode routing (module+export to funcRef), including input/output schema refs where present.

Runtime boot:
- FlowEngine and WorkerAdapter read the registry, register provider workers, and subscribe triggers. In dev, hot-reload rebuilds in-memory registry; runtimeConfig snapshot used for stability and metrics tags.

Security:
- No secrets in the registry; credentials remain in private runtime config outside `registry`.


## 13) SSR & Safety

- Guard server-only parts with `import.meta.server`.
- Python only runs on server; TS runner inprocess respects SSR. Task mode offers isolation.
- Graceful shutdown closes providers and child processes.


## 14) Mapping to Current Codebase

- `src/module.ts`: expand build hooks to compile registry and inject into Nitro runtimeConfig.
- `src/registry/**`: registry builder for processes, flows, indices (authoritative source).
- `src/runtime/**`: providers, runners, streaming, server APIs, engine:
  - queue utils -> QueueProvider façade (`src/runtime/server/utils/useQueue.ts` as starting point).
  - endpoints under `src/runtime/server/api/_queue/**` stay, wired to façade.
  - events: `src/runtime/server/streams/**` + `eventBus.ts` and `streamFactory.ts` are extended.
  - flows: `src/runtime/server/utils/useFlowEngine.ts` (or new `server/flow/engine.ts`).
  - processes: discovery aligns to `server/processes/**`; registration via provider-native APIs.
  - UI remains functional under `src/runtime/app/**` (dashboard, queue pages, etc.).


## 15) Types (abridged)

```ts
export type RunMode = 'queue' | 'flow' | 'call'

// Queue
export type QueueEvent = 'added'|'active'|'progress'|'completed'|'failed'|'waiting'
export interface JobInput { name: string; data: any; opts?: Record<string, any> }
export interface Job { id: string; name: string; data: any; state: 'waiting'|'active'|'completed'|'failed'; progress?: number; result?: any; error?: any }
export interface JobsQuery { state?: Job['state'][]; limit?: number; cursor?: string }
export interface QueueProvider { /* init, enqueue, schedule, getJob(s), on, pause, resume, close */ }

// Logger
export type LogLevel = 'debug'|'info'|'warn'|'error'
export interface LoggerProvider { log(l:LogLevel,msg:string,meta?:any):void; child(b:any):LoggerProvider }

// State
export interface StateProvider { get<T>(k:string):Promise<T|null>; set<T>(k:string,v:T,opts?:{ttl?:number}):Promise<void>; delete(k:string):Promise<void>; list(p:string,opts?:{limit?:number}):Promise<{keys:string[]}>; patch<T>(k:string,u:(prev:T|null)=>T,opts?:{retries?:number}):Promise<T> }

// Runner
export interface FuncRef { kind:'ts'|'py'; name:string; module?:string }
export interface RunContext { jobId?:string; queue?:string; state:StateProvider; logger:LoggerProvider; emit:(evt:any)=>void }
export interface StreamSink { send(frame:any):void; close(code?:number):void }
export interface Runner { run(funcRef:FuncRef,input:any,ctx:RunContext,stream?:StreamSink):Promise<{ok:true;result:any}|{ok:false;error:any}>; dispose():Promise<void> }

// Events
export interface EventRecord<T=any> { id:string; stream:string; ts:string; kind:string; subject?:string; data?:T; meta?:any; v?:number }
export interface EventStoreProvider { append<T>(s:string,e:Omit<EventRecord<T>,'id'|'ts'|'stream'>):Promise<EventRecord<T>>; read(s:string,opts?:{fromId?:string;limit?:number;direction?:'forward'|'backward'}):Promise<EventRecord[]>; subscribe(s:string,cb:(e:EventRecord)=>void):Promise<{unsubscribe():void}>; close():Promise<void> }

// Flow
export type FlowRole = 'entry'|'step'
export interface SubscriptionRule { stream: string | ((flowId:string,corr?:string)=>string); when?: { kind?: string | string[]; where?: (e:EventRecord)=>boolean }; map: (e:EventRecord)=>{ data:any; opts?:{ jobId?:string; delay?:number; priority?:number; attempts?:number; dedupe?:boolean } } }
export interface FlowConfig { id:string; role:FlowRole; step:string; emits?:string[]; version?:string; triggers?:string|string[]; subscriptions?:SubscriptionRule[]; compensation?:{ step:string; on:string|string[] } }

// Worker
export interface WorkerConfig {
  runMode?: RunMode
  queue?: string
  flow?: FlowConfig
  concurrency?: number
  rateLimit?: { max:number; durationMs:number }
  retryPolicy?: { attempts:number; backoff?:{type:'fixed'|'exponential';delayMs:number}; onFail?:'retry'|'dlq'|'drop' }
  dlq?: { enabled?: boolean; queue?: string }
  timeoutMs?: number
  idempotencyKey?: 'auto' | ((input:any)=>string)
  inputSchema?: any
  outputSchema?: any
}
```


## 16) Implementation Plan (Phased)

Phase 1: Provider façade + BullMQ mapping + Call mode (TS inprocess)
- Extract BullMQ provider (wrap current `$useQueue`), keep REST/WS compatibility.
- Introduce `QueueProvider` registry + `useQueue()` façade.
- Add `useRunner().call()` for TS inprocess and bridge to WS.
- Encapsulate WS streaming in a Streaming Bridge.

Phase 2: State Provider
- RedisState (unstorage) and PostgresState (useDatabase) with namespacing.

Phase 2b: Event Store + Bus + Projections
- Redis Streams and Postgres implementations.
- Append normalized queue events + runner emits.
- Basic projections (job snapshots, queue stats).

Phase 3: Flow Engine & Triggers
- Compile flow configs from registry; subscribe triggers; enqueue idempotent step jobs.
- Flow endpoints and timelines. Rename role to 'entry' in types and UI labels.

Phase 3b: TS Runner task mode
- Nitro task execution and optional spawn.

Phase 4: PgBoss provider
- Map APIs and event normalization; worker registration via `work()`.

Phase 5: Python Runner (basic)
- JSONL protocol per invocation; call mode first; later queue/flow adapters.

Phase 6: SSE fallback + polish
- SSE endpoints; client util chooses WS/SSE.


## 17) Testing & Acceptance Criteria

- Queue: enqueue and observe lifecycle via WS; switch provider to PgBoss without API changes.
- Call: `useRunner().call()` returns result immediately; streams frames; events persisted.
- State: read/write across runs.
- Flow: entry+step with trigger; idempotent enqueue; shared state; projections reflect timeline.
- Python: basic call + streaming.
- DLQ/retry/timeout/cancel behavior validated.
- Metrics and redaction work.
- Blob roundtrip for large payloads.


## 18) Migration Notes

- Existing `$useQueue` and REST/WS remain; internally route to provider façade.
- Streaming peer management moves into Streaming Bridge; `useQueueSubscription` stays compatible.
- Prefer placing processes under `server/processes/**`; export `queue` or `config.queue`, or let filename derive it. If migrating from `server/queues/**`, update `queue.workers.dir` to `'server/queues'` temporarily or move files.
- Add `config.runMode` only if you need flow/call; default is queue. For flows, add `config.flow` with `role:'entry'|'step'`.


## 19) Docs & DX

- Update README with examples for all run modes and provider selection.
- Provide templates for queue, flow main/step, and call.
- Playground demonstrates BullMQ and call vs queue.
- Document event schemas and stream naming.
- Explain discovery rules and multi-layer behavior.
