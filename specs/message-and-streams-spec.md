# Nuxt Queue: Messages, Streams, and Storage Spec (v0.2)

This document defines the canonical shape of messages on the in-process event bus, the stream taxonomy and record schemas, and the storage format and efficiency rules for persisted streams.

Goals:
- Single source of truth for live delivery (the in-process event bus) and a slim persisted store for query/history.
- Human-readable, flexible messages with clear, stable identities and minimal payload bloat.
- Data-efficient storage: append-only where possible, patch-based projections, bounded retention.
- Support step retries with clear attempt semantics and first-class traceability.
- Persist logs once without duplication, while enabling flow- and step-scoped queries efficiently.

Non-goals:
- Cross-process bus (use your queue provider or external infra for that).
- Complex envelope negotiation or content compression at the bus level (handled at the store layer if needed).

## 1) Bus Message Envelope

The bus carries in-process events for subscriptions by stream and by kind. Producers publish via the Event Manager; a store plugin persists selected events to the stream store and republishes canonical records.

### 1.1 Envelope shape

A Bus Message is a plain JSON-serializable object with the following fields (canonical):

- id: string
  - Store-assigned unique identifier within the stream. Omitted on ingress; required after persistence.
- stream: string
  - Stream name. Omitted on ingress; required after persistence.
- ts: string (ISO 8601)
  - Event timestamp. Set by the persister for canonical records.
- kind: string (required)
  - Namespaced kind in dot.case; examples: `flow.start`, `flow.complete`, `step.attempt.started`, `runner.log`.
- subject?: string
  - Audience-oriented subject (e.g., queue name). Optional.
- data?: any
  - JSON-serializable payload. Keep small; large artifacts via references.
- meta?: object
  - JSON-serializable annotations. Reserved keys:
    - flowId: string — Required for flow-scoped events (the run id).
    - flowName?: string — Flow name label.
    - stepKey?: string — Logical step key/name defined in the flow.
    - stepRunId?: string — Unique id per step attempt (attempt instance id).
    - attempt?: number — Attempt number for the step (1-based).
    - jobId?: string — Queue provider job id.
    - queue?: string — Queue name.
    - tags?: string[] — Free-form tags for filtering.
- v?: number
  - Schema version. Default: 1.

Constraints:
- Entire message must be JSON-serializable and under 64 KB by default. Prefer references for bulky data.
- Kinds should be stable; treat them as contracts between producers and consumers.

### 1.2 Event kinds (recommended set)

- Flow lifecycle:
  - `flow.start`, `flow.complete`.
- Step lifecycle with retry/attempt semantics:
  - `step.scheduled` — Step scheduled (before attempt starts); data may include reason/backoff.
  - `step.attempt.started` — An attempt started; include meta.stepRunId and meta.attempt.
  - `step.attempt.completed` — An attempt completed successfully; include meta.stepRunId and meta.attempt.
  - `step.attempt.failed` — An attempt failed; include error details in data, plus meta.stepRunId and meta.attempt.
  - `step.retry.scheduled` — A retry scheduled; include reason/backoff in data.
  - `step.completed` — Final step outcome across all attempts.
  - `step.failed` — Final failure after exhausting retries.
- Logs: `runner.log`
  - data: `{ level, msg, meta? }` (keep small; attach references as needed)
  - meta: include `flowId` and typically `stepKey`; include `stepRunId` and `attempt` when produced inside an attempt.

- Await/Trigger (pre-attempt gating for the next step):
  - `step.await.scheduled` — A gate is placed before starting the next step. Data may include:
    - `stepKey` (the upcoming step), `reason`: `time | webhook | event | manual`,
    - `until?` (ISO) for time-based waits,
    - `channel?` and `key?` for webhook/event correlation,
    - `token` (opaque) for unambiguous correlation.
  - `step.await.triggered` — The gate was released because the condition was met (e.g., webhook received, event seen, manual resume). Data includes `stepKey`, `by`: `webhook | event | manual | timeout`, and the matching `token`.
  - `step.await.timeout` — A time-based gate elapsed. Data includes `stepKey`, `token` and may include `elapsedMs`.
  - `step.await.cancelled` — The gate was cancelled (admin action or flow stop). Data includes `stepKey` and `token`.

### 1.3 Delivery semantics (dual-bus)

- Internal Bus (in-process): synchronous delivery via a singleton Node.js EventEmitter used only inside the server process for producing and wiring.
  - Producers publish ingress messages without `id` and `stream` on the Internal Bus.
  - StreamStore wiring consumes these ingress messages and persists canonical records and projections. It does not re-emit canonical events on the Internal Bus.
- Store Bus (DB-tailed): a separate process/subsystem that subscribes to the persisted streams (e.g., Redis Streams XRANGE/XREAD, Postgres LISTEN/NOTIFY) and publishes canonical records to clients and horizontally scaled server instances.
  - Consumers (UI, SSE/WS, external services, or other server nodes) subscribe to the Store Bus and always receive canonical records (with `id` and `stream`).
  - Projections are not retransmitted on the Internal Bus; they are read and forwarded by the Store Bus.

## 2) Streams and Record Schemas

Streams are named, append-only sequences of canonical records. A minimal set of streams are persisted; everything else is live-only on the bus.

### 2.1 Naming

- Timeline:
  - Flow timeline (per run): `nq:flow:<flowId>` — single source of truth for all flow lifecycle, step attempt lifecycle, and logs.
- Projections (append-only patch/index streams; compact, derived):
  - Flow run snapshot patches (per run): `nq:proj:flow:<flowName>:<flowId>`
  - Per-run per-step patches (logical step state across attempts): `nq:proj:flow-steps:<flowId>`
  - Flow runs index (per flow name): `nq:proj:flow-runs:<flowName>`
  - Step log index (per flow run): `nq:proj:flow-step-index:<flowId>` — records reference `runner.log` in the flow timeline and include `stepKey`; no payload duplication.

Naming rules:
- Use `:` as a separator, `-` or `_` inside tokens, avoid spaces.
- `<flowId>` is the stable id for the run; usually a UUID or (when configured) a deterministic id (e.g., first job id).

### 2.2 Canonical record shape (persisted)

Canonical persisted records match the Bus Message envelope with the following constraints:
- id: required and unique within a stream; monotonically increasing by underlying store rules (e.g., Redis stream id).
- stream: required and matches the stream being appended to.
- ts: required; ISO 8601.
- For projection/index records that point to timeline entries, prefer including a pointer inside `data`, e.g. `data.ref = { stream, id }`, to avoid duplicating payload.

### 2.3 Per-stream contract: kinds and data

The following kinds MAY appear in the flow timeline stream `nq:flow:<flowId>`:
- `flow.start` — data: `{ flowName }`; meta.flowId required; subject: queue name recommended.
- `flow.complete` — data: `{ ...optional }`; meta.flowId required.
- `step.scheduled` — data: `{ stepKey, reason?, backoffMs? }`; meta.flowId and meta.stepKey required.
- `step.attempt.started` — data: `{ stepKey }`; meta.flowId, meta.stepKey, meta.stepRunId, meta.attempt required.
- `step.attempt.completed` — data: `{ stepKey, result? }`; meta.flowId, meta.stepKey, meta.stepRunId, meta.attempt required.
- `step.attempt.failed` — data: `{ stepKey, error }`; meta.flowId, meta.stepKey, meta.stepRunId, meta.attempt required.
- `step.retry.scheduled` — data: `{ stepKey, reason?, backoffMs? }`; meta.flowId, meta.stepKey required.
- `step.completed` — data: `{ stepKey, result? }`; meta.flowId, meta.stepKey required.
- `step.failed` — data: `{ stepKey, error }`; meta.flowId, meta.stepKey required.
- `runner.log` — data: `{ level, msg, meta? }`; meta.flowId required; meta.stepKey recommended; include meta.stepRunId and meta.attempt when inside an attempt.
- `step.await.scheduled` — data: `{ stepKey, reason, until?, channel?, key?, token }`; pre-attempt gate for the next step; meta.flowId required.
- `step.await.triggered` — data: `{ stepKey, by, token }`; meta.flowId required.
- `step.await.timeout` — data: `{ stepKey, token, elapsedMs? }`; meta.flowId required.
- `step.await.cancelled` — data: `{ stepKey, token }`; meta.flowId required.

Projection streams are derived, compact, and patch-based:

- Flow snapshot patches `nq:proj:flow:<flowName>:<flowId>` with kind `flow.snapshot.patch` and data fields:
  - status?: `running | completed | failed | string`
  - flowName?: string
  - flowId?: string
  - queue?: string
  - startedAt?: ISO string
  - completedAt?: ISO string
  - lastEventAt?: ISO string
  - logsCountDelta?: number (relative increment)
  - lastLogLevel?: `debug | info | warn | error | string`
  - steps?: { [stepKey: string]: { triesCount?: number, lastAttempt?: number, status?: string } } (optional aggregates)
  - waitingFor?: `time | webhook | event | manual` (when a gate is active)
  - waitUntil?: ISO string (for `time` gates)
  - waitToken?: string (opaque correlation id)
  - waitStep?: string (the upcoming stepKey that is gated)

- Per-step patches `nq:proj:flow-steps:<flowId>` with kind `flow.step.patch` and data fields:
  - stepKey: string (required)
  - status?: `running | completed | failed | string`
  - startedAt?: ISO string
  - completedAt?: ISO string
  - lastEventAt?: ISO string
  - logsCountDelta?: number
  - lastLogLevel?: string
  - triesCountDelta?: number — increment when an attempt starts.
  - attempt?: number — last seen attempt number for the step.
  - lastAttemptStatus?: `running | completed | failed | string`
  - waiting?: boolean — whether a pre-attempt gate is active for this step.
  - waitingFor?: `time | webhook | event | manual`
  - waitUntil?: ISO string
  - waitToken?: string

- Flow run index `nq:proj:flow-runs:<flowName>` with kind `flow.run.indexed` and data fields:
  - id: string (flowId; required)
  - flowName: string
  - queue?: string
  - createdAt: ISO string
  - sourceId: string (id of the source event used to create the index entry)

— Step log index `nq:proj:flow-step-index:<flowId>` with kind `flow.step.log.ref` and data fields:
  - ref: { stream: string, id: string } — pointer to a `runner.log` record in `nq:flow:<flowId>`.
  - stepKey: string
  - attempt?: number
  - level?: string
  - ts: ISO string (duplicate of referenced ts to speed up sorting only; optional)

Reducers can process projection streams in order to compute current snapshots. Step log index streams allow efficient step-scoped log queries without duplicating log payloads.

### 2.4 Subscriptions and tails

- Stream subscriptions for clients use the Store Bus, which delivers canonical records from the database.
- Tails via SSE/WS should:
  - Optionally backfill the last N records via a read (adapter.read), then subscribe via the Store Bus.
  - Encode payloads as `{ v:1, stream, event: kind, record }` for the client.

## 3) Storage: Adapters and Efficiency

Only a minimal set of streams are persisted:
- `nq:flow:<flowId>` — run timeline (single source of truth for events & logs)
- `nq:proj:flow:<flowName>:<flowId>` — run snapshot patches
- `nq:proj:flow-steps:<flowId>` — per-step patches (across attempts)
- `nq:proj:flow-runs:<flowName>` — run indices
- `nq:proj:flow-step-index:<flowId>` — step log indices per run (references only)

### 3.1 Adapters

- Redis Streams (preferred): append/read/trim using XADD/XREAD, with MAXLEN or retention policy.
- File (dev/test): line-delimited JSON, optional gzip rotation.
- Memory (test): ring buffer per stream.

All adapters expose a common interface: `append(stream, record) -> canonical record`, `read(stream, opts) -> record[]`, `subscribe(stream, onEvent) -> unsubscribe` (subscription may be emulated or no-op if bus-based).

### 3.2 Canonical record on disk/wire

Store-level record equals canonical event envelope. For Redis, map fields to a single JSON value payload or hash fields, but keep the envelope stable:

```json
{
  "id": "1719667845123-0",
  "stream": "nq:flow:6d1a…",
  "ts": "2025-10-28T12:34:56.789Z",
  "kind": "step.attempt.completed",
  "subject": "example_queue",
  "data": { "stepKey": "first_step", "queue": "example_queue" },
  "meta": { "flowId": "6d1a…", "stepKey": "first_step", "attempt": 1 },
  "v": 1
}
```

### 3.3 Efficiency rules

- Use patches for projections; avoid rewriting full snapshots.
- Keep `data` small; use references for large payloads (e.g., URLs or keys).
- Retention & trimming:
  - Flow timeline: trim by max length or TTL based on deployment needs.
  - Projection patches: fewer, but may also be trimmed after archiving.
  - Index streams: compact and kept long-term; consider periodic compaction.
- De-duplication: Persist log payloads only once in `nq:flow:<flowId>`. Use `nq:proj:flow-step-index:<flowId>:<stepKey>` to reference them per step (pointer records only). Avoid duplicate index entries.
- Compression: Optional at the file adapter; avoid compressing at the bus.

### 3.4 Ingress → Store → Canonical flow (dual-bus)

1. Producer calls Event Manager `publish({ kind, data, meta? }, ctx)`.
2. Event Manager publishes an ingress message on the Internal Bus (no `id`/`stream`).
3. StreamStore wiring persists canonical records to `nq:flow:<flowId>` and projection streams; for step logs, it appends a pointer record to `nq:proj:flow-step-index:<flowId>` referencing the timeline record.
4. Store Bus tails the persisted streams and delivers canonical records to clients (SSE/WS) and other nodes for horizontal scaling.
5. Readers can query the store via adapter.read for backfills; live updates come from the Store Bus.

## 4) Examples

### 4.1 Ingress vs canonical

Ingress (Internal Bus only):
```json
{
  "ts": "2025-10-28T12:34:00.000Z",
  "kind": "runner.log",
  "subject": "example_queue",
  "data": { "level": "info", "msg": "Parallel step progress 1/5", "meta": { "progress": 1 } },
  "meta": { "flowId": "6d1a…", "stepKey": "parallel_step", "attempt": 1 },
  "v": 1
}
```

Canonical (persisted + published via Store Bus):
```json
{
  "id": "1719667845123-1",
  "stream": "nq:flow:6d1a…",
  "ts": "2025-10-28T12:34:56.123Z",
  "kind": "runner.log",
  "subject": "example_queue",
  "data": { "level": "info", "msg": "Parallel step progress 1/5", "meta": { "progress": 1 } },
  "meta": { "flowId": "6d1a…", "stepKey": "parallel_step", "attempt": 1 },
  "v": 1
}
```

### 4.2 Projection records

Flow snapshot patch:
```json
{ "kind": "flow.snapshot.patch", "data": { "status": "running", "flowName": "example-flow", "flowId": "6d1a…", "queue": "example_queue", "startedAt": "2025-10-28T12:30:00.000Z", "lastEventAt": "2025-10-28T12:30:00.000Z" }, "v": 1 }
```

Flow runs index:
```json
{ "kind": "flow.run.indexed", "data": { "id": "6d1a…", "flowName": "example-flow", "queue": "example_queue", "createdAt": "2025-10-28T12:30:00.000Z", "sourceId": "1719667800000-0" }, "v": 1 }
```

Per-step patch:
```json
{ "kind": "flow.step.patch", "data": { "stepKey": "second_step", "status": "running", "attempt": 1, "triesCountDelta": 1, "startedAt": "2025-10-28T12:31:00.000Z", "lastEventAt": "2025-10-28T12:31:00.000Z" }, "v": 1 }
```

Await scheduled (timeline) and its projection effects:
```json
{ "kind": "step.await.scheduled", "data": { "stepKey": "second_step", "reason": "webhook", "channel": "webhook", "key": "order/123", "token": "abc123" }, "meta": { "flowId": "6d1a…" }, "v": 1 }
```

Flow snapshot patch reflecting waiting status:
```json
{ "kind": "flow.snapshot.patch", "data": { "waitingFor": "webhook", "waitToken": "abc123", "waitStep": "second_step", "lastEventAt": "2025-10-28T12:31:02.000Z" }, "v": 1 }
```

Await triggered (timeline) and clearing waiting in projections:
```json
{ "kind": "step.await.triggered", "data": { "stepKey": "second_step", "by": "webhook", "token": "abc123" }, "meta": { "flowId": "6d1a…" }, "v": 1 }
```
```json
{ "kind": "flow.snapshot.patch", "data": { "waitingFor": null, "waitToken": null, "waitStep": null, "lastEventAt": "2025-10-28T12:31:10.000Z" }, "v": 1 }
```

Step log index record (reference only):
```json
{ "kind": "flow.step.log.ref", "data": { "stepKey": "second_step", "attempt": 1, "ref": { "stream": "nq:flow:6d1a…", "id": "1719667845123-5" }, "level": "info", "ts": "2025-10-28T12:31:05.000Z" }, "v": 1 }
```

## 5) Compatibility & Migration

- This v0.2 spec introduces breaking changes in identity fields (`traceId` → `flowId`, `stepId` → `stepKey`/`stepRunId` with `attempt`) and adds retry-aware kinds.
- Persist logs only once in the flow timeline; step log queries should use the step log index stream to avoid duplication.
- Consumers should subscribe to streams or kinds depending on use case; by default, prefer canonical-only delivery (require both `id` and `stream`).
- For existing deployments, migrate stream names to the patterns above and adjust reducers to the patch shapes. Provide a translation layer if you need to interoperate temporarily.

## 6) Rationale (summary)

- Separation of concerns: Event Manager focuses on live delivery and simple publishing; store plugins are responsible for persistence and projections.
- Efficiency via patches and narrow persistence scope keeps storage small and reads fast.
- Explicit, readable envelope with a few reserved meta fields balances flexibility and clarity.
- Retry semantics and step log indexing provide clarity for operations while avoiding payload duplication.
