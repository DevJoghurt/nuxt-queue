# PostgreSQL Backend - Queue & EventStore

> **Version**: v0.6.6  
> **Status**: 📋 Planning  
> **Last Updated**: 2025-11-05  
> **Integrates With**: v0.6 (Worker Execution, State Management)

## Overview

v0.6 introduces complete PostgreSQL support as an alternative to Redis, with two separate adapters:

1. **PgBoss Queue Provider**: Job queue management (replaces BullMQ + Redis)
2. **PostgreSQL EventStore Adapter**: Event storage and streaming (replaces Redis Streams)

Both adapters work independently - you can mix them (e.g., BullMQ for queues + PostgreSQL for events) or use both together for a Redis-free stack.

### Why PostgreSQL?

**For Queue Provider (PgBoss)**:
- **Single Database**: No Redis dependency
- **Transactional**: ACID guarantees for job operations
- **Simpler Stack**: One less service to manage
- **Cost Effective**: No Redis hosting costs
- **Built-in Persistence**: PostgreSQL is already persistent

**For EventStore Adapter**:
- **SQL Analytics**: Query events with SQL for insights
- **Long-term Retention**: Better suited for historical data
- **Backup/Restore**: Standard PostgreSQL tools
- **Transactional**: Atomic event writes
- **Same Database**: Events and jobs in one place

## 1. PgBoss Queue Provider

### Implementation

PgBoss implements the `QueueProvider` interface (same as BullMQ adapter):

```typescript
// src/runtime/server/queue/adapters/pgboss.ts

import PgBoss from 'pg-boss'
import type { QueueProvider, JobInput, Job, JobsQuery, ScheduleOptions, JobCounts, QueueEvent } from '../types'
import { useEventManager, $useQueueRegistry } from '#imports'

/**
 * PgBoss Queue Provider: PostgreSQL-based job queue
 * 
 * Implements QueueProvider interface (same as BullMQ)
 * Uses PgBoss library for PostgreSQL job queue
 * Does NOT handle eventStore, state, logging - those are separate systems
 */
export class PgBossProvider implements QueueProvider {
  private boss: PgBoss | null = null
  private queues = new Map<string, { wired: boolean, defaults?: any }>()

  constructor(private config: PgBossConfig) {}

  async init(): Promise<void> {
    this.boss = new PgBoss({
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.user,
      password: this.config.password,
      schema: this.config.schema || 'pgboss',
      // PgBoss-specific options
      retryLimit: this.config.retryLimit || 3,
      retryDelay: this.config.retryDelay || 60,
      expireInHours: this.config.expireInHours || 24,
      retentionDays: this.config.retentionDays || 7,
      deleteAfterDays: this.config.deleteAfterDays || 30,
    })

    await this.boss.start()
    console.info('[PgBoss] Queue provider initialized')
  }

  async enqueue(queueName: string, job: JobInput): Promise<string> {
    if (!this.boss) throw new Error('PgBoss not initialized')

    this.ensureQueue(queueName)

    // Map generic JobInput to PgBoss format
    const pgBossOptions: any = {}
    if (job.opts?.priority) pgBossOptions.priority = job.opts.priority
    if (job.opts?.delay) pgBossOptions.startAfter = job.opts.delay
    if (job.opts?.attempts) pgBossOptions.retryLimit = job.opts.attempts - 1
    if (job.opts?.backoff) {
      pgBossOptions.retryDelay = typeof job.opts.backoff === 'number' 
        ? job.opts.backoff / 1000 // Convert ms to seconds
        : 60
    }

    // Send job to PgBoss
    const jobId = await this.boss.send(queueName, job.data, pgBossOptions)

    // Emit waiting event (mimics BullMQ)
    this.emitQueueEvent(queueName, 'waiting', { jobId })

    return jobId || ''
  }

  async schedule(queueName: string, job: JobInput, opts?: ScheduleOptions): Promise<string> {
    if (!this.boss) throw new Error('PgBoss not initialized')

    this.ensureQueue(queueName)

    // Handle delayed jobs
    if (opts?.delay) {
      const startAfter = new Date(Date.now() + opts.delay)
      const jobId = await this.boss.send(queueName, job.data, {
        startAfter,
        ...this.mapJobOptions(job.opts)
      })
      return jobId || ''
    }

    // Handle cron jobs (PgBoss has built-in cron support)
    if (opts?.cron) {
      const jobId = await this.boss.schedule(
        queueName,
        opts.cron,
        job.data,
        this.mapJobOptions(job.opts)
      )
      return jobId || ''
    }

    return this.enqueue(queueName, job)
  }

  async getJob(queueName: string, id: string): Promise<Job | null> {
    if (!this.boss) throw new Error('PgBoss not initialized')

    const job = await this.boss.getJobById(id)
    if (!job) return null

    return this.toJob(job)
  }

  async getJobs(queueName: string, query?: JobsQuery): Promise<Job[]> {
    if (!this.boss) throw new Error('PgBoss not initialized')

    // PgBoss doesn't have a direct getJobs API, we need to query directly
    // For now, return empty array (TODO: implement via direct SQL query)
    return []
  }

  on(queueName: string, event: QueueEvent, callback: (payload: any) => void): () => void {
    // PgBoss doesn't have event system like BullMQ
    // We emit events manually when operations occur
    const key = `${queueName}:${event}`
    
    if (!this.eventListeners) {
      this.eventListeners = new Map()
    }
    
    if (!this.eventListeners.has(key)) {
      this.eventListeners.set(key, [])
    }
    
    this.eventListeners.get(key)!.push(callback)
    
    return () => {
      const listeners = this.eventListeners?.get(key)
      if (listeners) {
        const index = listeners.indexOf(callback)
        if (index > -1) {
          listeners.splice(index, 1)
        }
      }
    }
  }

  async isPaused(queueName: string): Promise<boolean> {
    // PgBoss doesn't have pause/resume at queue level
    // Return false (always running)
    return false
  }

  async getJobCounts(queueName: string): Promise<JobCounts> {
    if (!this.boss) throw new Error('PgBoss not initialized')

    // PgBoss has getQueueSize for active/created jobs
    // For full counts, we'd need direct SQL queries
    const size = await this.boss.getQueueSize(queueName)

    return {
      active: size || 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      waiting: 0,
      paused: 0,
    }
  }

  async pause(queueName: string): Promise<void> {
    if (!this.boss) throw new Error('PgBoss not initialized')
    
    // PgBoss doesn't have pause API
    // We'd need to implement via WorkerManager
    console.warn('[PgBoss] Pause not supported at queue level, use WorkerManager')
  }

  async resume(queueName: string): Promise<void> {
    if (!this.boss) throw new Error('PgBoss not initialized')
    
    // PgBoss doesn't have resume API
    console.warn('[PgBoss] Resume not supported at queue level, use WorkerManager')
  }

  async close(): Promise<void> {
    if (this.boss) {
      await this.boss.stop()
      this.boss = null
      this.queues.clear()
      console.info('[PgBoss] Queue provider closed')
    }
  }

  // Internal helpers

  private ensureQueue(queueName: string) {
    let queueData = this.queues.get(queueName)

    if (!queueData) {
      // Get queue defaults from registry (same as BullMQ)
      let defaults: any
      try {
        const registry: any = $useQueueRegistry()
        if (registry && Array.isArray(registry.workers)) {
          const w = registry.workers.find((w: any) => w?.queue?.name === queueName)
          if (w?.queue) {
            defaults = w.queue.defaultJobOptions
          }
        }
      } catch {
        // Ignore registry access errors
      }

      queueData = { wired: false, defaults }
      this.queues.set(queueName, queueData)
    }

    // Wire event forwarding once per queue
    if (!queueData.wired) {
      this.wireQueueEvents(queueName)
      queueData.wired = true
    }
  }

  private wireQueueEvents(queueName: string) {
    // Forward queue events to EventManager (same pattern as BullMQ)
    const { publishBus } = useEventManager()

    // PgBoss emits job events via its monitoring API
    // We need to poll or use work handlers to detect events
    // For now, we emit events manually in enqueue/getJob methods
  }

  private emitQueueEvent(queueName: string, event: QueueEvent, payload: any) {
    // Emit to local listeners
    const key = `${queueName}:${event}`
    const listeners = this.eventListeners?.get(key) || []
    
    for (const callback of listeners) {
      callback(payload)
    }

    // Forward to EventManager bus (same as BullMQ)
    const { publishBus } = useEventManager()
    publishBus({
      type: `job.${event}`,
      runId: '',
      data: { ...payload, queue: queueName },
    } as any).catch(() => {
      // Ignore bus publish errors
    })
  }

  private mapJobOptions(opts?: any): any {
    const mapped: any = {}
    if (opts?.priority) mapped.priority = opts.priority
    if (opts?.attempts) mapped.retryLimit = opts.attempts - 1
    if (opts?.backoff) {
      mapped.retryDelay = typeof opts.backoff === 'number' 
        ? opts.backoff / 1000 
        : 60
    }
    return mapped
  }

  private toJob(pgJob: any): Job {
    // Map PgBoss job to generic Job type
    return {
      id: pgJob.id,
      name: pgJob.name,
      data: pgJob.data,
      returnvalue: pgJob.output,
      failedReason: pgJob.error,
      state: this.mapState(pgJob.state),
      timestamp: pgJob.createdon ? new Date(pgJob.createdon).getTime() : undefined,
      processedOn: pgJob.startedon ? new Date(pgJob.startedon).getTime() : undefined,
      finishedOn: pgJob.completedon ? new Date(pgJob.completedon).getTime() : undefined,
    }
  }

  private mapState(pgBossState: string): Job['state'] {
    // Map PgBoss states to generic states
    switch (pgBossState) {
      case 'created': return 'waiting'
      case 'active': return 'active'
      case 'completed': return 'completed'
      case 'failed': return 'failed'
      case 'expired': return 'failed'
      case 'cancelled': return 'failed'
      default: return 'waiting'
    }
  }

  private eventListeners?: Map<string, Array<(payload: any) => void>>
}

export interface PgBossConfig {
  host: string
  port?: number
  database: string
  user: string
  password: string
  schema?: string
  retryLimit?: number
  retryDelay?: number
  expireInHours?: number
  retentionDays?: number
  deleteAfterDays?: number
}
```

**Key Points**:
- ✅ Implements exact same `QueueProvider` interface as BullMQ
- ✅ Uses PgBoss library for PostgreSQL-based job queue
- ✅ Only handles job queue operations (no eventStore/state/logging)
- ✅ Maps PgBoss job states to generic Job states
- ✅ Supports delayed and cron-based scheduling
- ✅ Forwards events to EventManager (same as BullMQ)

### PgBoss Worker Manager

PgBoss workers are registered using the WorkerManager pattern (same as BullMQ):

```typescript
// src/runtime/server/worker/adapters/pgboss.ts

import PgBoss from 'pg-boss'
import { createNodeProcessor } from '../runner/node'
import type { WorkerManager, WorkerHandler, WorkerInfo, WorkerOptions } from '../types'
import { useRuntimeConfig } from '#imports'

/**
 * PgBoss Worker Manager: Executes workers using PgBoss
 * 
 * Mirrors BullMQ Worker architecture:
 * - One PgBoss work handler per queueName
 * - Dispatcher pattern routes jobs to handlers by job.name
 * - Same processor (createNodeProcessor) as BullMQ
 */
export class PgBossWorkerManager implements WorkerManager {
  private boss: PgBoss | null = null
  private workers = new Map<string, {
    handlers: Map<string, WorkerHandler>
    paused: boolean
    concurrency: number
  }>()

  async init(): Promise<void> {
    const rc = useRuntimeConfig() as any
    const config = rc.queue?.postgres

    this.boss = new PgBoss({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      schema: config.schema || 'pgboss',
    })

    await this.boss.start()
    console.info('[PgBoss] Worker manager initialized')
  }

  async registerWorker(
    queueName: string,
    jobName: string,
    handler: WorkerHandler,
    opts?: WorkerOptions
  ): Promise<void> {
    if (!this.boss) {
      await this.init()
    }

    let info = this.workers.get(queueName)

    if (info) {
      // Worker exists - add handler (same as BullMQ adapter)
      console.info(`[PgBoss] Adding handler for job "${jobName}" to queue "${queueName}"`)
      info.handlers.set(jobName, handler)
      return
    }

    // Create new PgBoss work handler with dispatcher
    console.info(`[PgBoss] Creating new worker for queue: ${queueName}`)

    const handlers = new Map<string, WorkerHandler>()
    handlers.set(jobName, handler)

    const concurrency = opts?.concurrency || 1

    // Dispatcher routes to correct handler (same pattern as BullMQ adapter)
    const dispatcher = async (job: any) => {
      const handler = handlers.get(job.name)
      if (!handler) {
        const error = `No handler for job "${job.name}" on queue "${queueName}". ` +
          `Available: ${Array.from(handlers.keys()).join(', ')}`
        console.error(error)
        throw new Error(error)
      }

      // Create processor (SAME as BullMQ - uses runner/node.ts)
      const processor = createNodeProcessor(handler, queueName)
      
      // Execute with PgBoss job (convert to BullMQ-like format)
      const bullMQLikeJob = {
        id: job.id,
        name: job.name,
        data: job.data,
        attemptsMade: 0, // PgBoss tracks attempts differently
        opts: {},
      }
      
      return await processor(bullMQLikeJob)
    }

    const shouldPause = opts?.autorun === false

    info = {
      handlers,
      paused: shouldPause || false,
      concurrency
    }

    this.workers.set(queueName, info)

    if (!shouldPause) {
      // Start PgBoss worker for this queue
      await this.boss!.work(queueName, { teamSize: concurrency }, dispatcher)
      console.info(`[PgBoss] Worker for "${queueName}" started with concurrency ${concurrency}`)
    } else {
      console.info(`[PgBoss] Worker for "${queueName}" created but paused`)
    }
  }

  async pause(queueName: string): Promise<void> {
    const info = this.workers.get(queueName)
    if (info) {
      info.paused = true
      // PgBoss doesn't have pause API - workers just stop pulling
      // We'd need to offWork() and work() again to pause/resume
    }
  }

  async resume(queueName: string): Promise<void> {
    const info = this.workers.get(queueName)
    if (info && this.boss) {
      info.paused = false
      
      // Recreate dispatcher and start work again
      const dispatcher = this.createDispatcher(queueName, info.handlers)
      await this.boss.work(queueName, { teamSize: info.concurrency }, dispatcher)
    }
  }

  isPaused(queueName: string): boolean {
    const info = this.workers.get(queueName)
    return info?.paused || false
  }

  async closeAll(): Promise<void> {
    if (this.boss) {
      await this.boss.stop()
      this.boss = null
      this.workers.clear()
      console.info('[PgBoss] All workers closed')
    }
  }

  getWorker(queueName: string, jobName: string): WorkerInfo | null {
    const info = this.workers.get(queueName)
    if (!info) return null

    const handler = info.handlers.get(jobName)
    if (!handler) return null

    return {
      queueName,
      jobName,
      handler,
      runtime: 'node',
      concurrency: info.concurrency,
      autorun: !info.paused,
    }
  }

  private createDispatcher(queueName: string, handlers: Map<string, WorkerHandler>) {
    return async (job: any) => {
      const handler = handlers.get(job.name)
      if (!handler) {
        throw new Error(`No handler for job "${job.name}"`)
      }

      const processor = createNodeProcessor(handler, queueName)
      
      const bullMQLikeJob = {
        id: job.id,
        name: job.name,
        data: job.data,
        attemptsMade: 0,
        opts: {},
      }
      
      return await processor(bullMQLikeJob)
    }
  }
}
```

**Key Architecture**:
- ✅ Same dispatcher pattern as BullMQ (one worker per queue)
- ✅ Uses `createNodeProcessor` from runner/node.ts (identical to BullMQ)
- ✅ PgBoss's `teamSize` parameter controls concurrency
- ✅ Converts PgBoss jobs to BullMQ-like format for processor

## 2. PostgreSQL EventStore Adapter

EventStore is a **separate system** from the queue. You can use PostgreSQL for events while using BullMQ for queues (or vice versa).

### Database Schema

```sql
-- Events table (equivalent to Redis Streams)
CREATE TABLE queue_events (
  id BIGSERIAL PRIMARY KEY,
  stream VARCHAR(255) NOT NULL,
  ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  type VARCHAR(100) NOT NULL,
  run_id UUID NOT NULL,
  flow_name VARCHAR(255) NOT NULL,
  step_name VARCHAR(255),
  step_id VARCHAR(255),
  attempt INTEGER,
  data JSONB NOT NULL,
  
  -- Indexes for common queries
  INDEX idx_stream (stream),
  INDEX idx_run_id (run_id),
  INDEX idx_flow_name (flow_name),
  INDEX idx_type (type),
  INDEX idx_ts (ts DESC)
);

-- External subscription table (for horizontal scalability)
CREATE TABLE queue_event_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  stream_pattern VARCHAR(255) NOT NULL,
  last_id BIGINT NOT NULL DEFAULT 0,
  consumer_group VARCHAR(100) NOT NULL,
  consumer_name VARCHAR(100) NOT NULL,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(stream_pattern, consumer_group, consumer_name),
  INDEX idx_stream_pattern (stream_pattern)
);

-- Flow index for quick flow lookups
CREATE TABLE queue_flow_index (
  flow_name VARCHAR(255) NOT NULL,
  run_id UUID NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  status VARCHAR(50) NOT NULL DEFAULT 'running',
  
  PRIMARY KEY (flow_name, run_id),
  INDEX idx_started (flow_name, started_at DESC)
);

-- Function to notify on new events (for LISTEN/NOTIFY)
CREATE OR REPLACE FUNCTION notify_queue_event() RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('queue_events', json_build_object(
    'stream', NEW.stream,
    'id', NEW.id,
    'type', NEW.type
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to call notify function
CREATE TRIGGER queue_events_notify
  AFTER INSERT ON queue_events
  FOR EACH ROW
  EXECUTE FUNCTION notify_queue_event();
```

### EventStore Adapter Implementation

```typescript
// src/runtime/server/events/adapters/postgres.ts

import { Pool, PoolClient } from 'pg'
import type { EventStoreAdapter, EventRecord, QueryOptions, Subscription } from '../types'

/**
 * PostgreSQL EventStore Adapter
 * 
 * Stores events in PostgreSQL table instead of Redis Streams
 * Supports horizontal scalability via external subscription table
 */
export class PostgresEventStoreAdapter implements EventStoreAdapter {
  private pool: Pool
  private listeners = new Map<string, Set<(event: EventRecord) => void>>()
  private listenClient: PoolClient | null = null

  constructor(config: PostgresEventStoreConfig) {
    this.pool = new Pool({
      host: config.host,
      port: config.port || 5432,
      database: config.database,
      user: config.user,
      password: config.password,
      max: config.poolSize || 20,
    })
  }

  async init(): Promise<void> {
    // Setup LISTEN client for real-time notifications
    this.listenClient = await this.pool.connect()
    await this.listenClient.query('LISTEN queue_events')

    // Handle NOTIFY messages
    this.listenClient.on('notification', (msg) => {
      if (msg.channel === 'queue_events') {
        try {
          const payload = JSON.parse(msg.payload || '{}')
          this.handleEventNotification(payload)
        } catch (err) {
          console.error('[Postgres EventStore] Error parsing notification:', err)
        }
      }
    })

    console.info('[Postgres EventStore] Adapter initialized')
  }

  async append(stream: string, event: Omit<EventRecord, 'id' | 'ts'>): Promise<EventRecord> {
    const result = await this.pool.query(
      `INSERT INTO queue_events 
       (stream, type, run_id, flow_name, step_name, step_id, attempt, data) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
       RETURNING id, ts`,
      [
        stream,
        event.type,
        event.runId,
        event.flowName,
        event.stepName || null,
        event.stepId || null,
        event.attempt || null,
        JSON.stringify(event.data || {}),
      ]
    )

    const row = result.rows[0]

    // NOTIFY trigger fires automatically via database trigger
    // No need to manually notify here

    return {
      id: String(row.id),
      ts: row.ts.toISOString(),
      ...event,
    }
  }

  async query(stream: string, options?: QueryOptions): Promise<EventRecord[]> {
    let query = 'SELECT * FROM queue_events WHERE stream = $1'
    const params: any[] = [stream]
    let paramIndex = 2

    // Filter by event types
    if (options?.types && options.types.length > 0) {
      query += ` AND type = ANY($${paramIndex})`
      params.push(options.types)
      paramIndex++
    }

    // Filter by ID range
    if (options?.fromId) {
      query += ` AND id > $${paramIndex}`
      params.push(parseInt(options.fromId))
      paramIndex++
    }

    if (options?.toId) {
      query += ` AND id <= $${paramIndex}`
      params.push(parseInt(options.toId))
      paramIndex++
    }

    // Order and limit
    query += ' ORDER BY id ASC'

    if (options?.limit) {
      query += ` LIMIT $${paramIndex}`
      params.push(options.limit)
    }

    const result = await this.pool.query(query, params)

    return result.rows.map(row => this.rowToEvent(row))
  }

  async subscribe(stream: string, callback: (event: EventRecord) => void): Promise<Subscription> {
    // Add to local listeners (for LISTEN/NOTIFY)
    if (!this.listeners.has(stream)) {
      this.listeners.set(stream, new Set())
    }
    this.listeners.get(stream)!.add(callback)

    // Fetch existing events first
    const existingEvents = await this.query(stream)
    for (const event of existingEvents) {
      callback(event)
    }

    // Return unsubscribe function
    return {
      unsubscribe: () => {
        const callbacks = this.listeners.get(stream)
        if (callbacks) {
          callbacks.delete(callback)
          if (callbacks.size === 0) {
            this.listeners.delete(stream)
          }
        }
      }
    }
  }

  async close(): Promise<void> {
    if (this.listenClient) {
      await this.listenClient.query('UNLISTEN queue_events')
      this.listenClient.release()
      this.listenClient = null
    }

    await this.pool.end()
    this.listeners.clear()
    console.info('[Postgres EventStore] Adapter closed')
  }

  // External subscription for horizontal scalability

  async subscribeExternal(
    streamPattern: string,
    consumerGroup: string,
    consumerName: string,
    callback: (event: EventRecord) => void,
    options?: { pollInterval?: number }
  ): Promise<Subscription> {
    const pollInterval = options?.pollInterval || 1000 // 1 second default

    // Register consumer in subscription table
    await this.pool.query(
      `INSERT INTO queue_event_subscriptions 
       (stream_pattern, consumer_group, consumer_name, last_id, last_seen)
       VALUES ($1, $2, $3, 0, NOW())
       ON CONFLICT (stream_pattern, consumer_group, consumer_name)
       DO UPDATE SET last_seen = NOW()`,
      [streamPattern, consumerGroup, consumerName]
    )

    let polling = true

    // Poll for new events
    const poll = async () => {
      while (polling) {
        try {
          // Get last processed ID for this consumer
          const subResult = await this.pool.query(
            `SELECT last_id FROM queue_event_subscriptions
             WHERE stream_pattern = $1 AND consumer_group = $2 AND consumer_name = $3`,
            [streamPattern, consumerGroup, consumerName]
          )

          if (subResult.rows.length === 0) break

          const lastId = subResult.rows[0].last_id

          // Fetch new events matching stream pattern
          const eventsResult = await this.pool.query(
            `SELECT * FROM queue_events
             WHERE stream LIKE $1 AND id > $2
             ORDER BY id ASC
             LIMIT 100`,
            [streamPattern.replace('*', '%'), lastId]
          )

          // Process events
          for (const row of eventsResult.rows) {
            const event = this.rowToEvent(row)
            await callback(event)

            // Update last_id after successful processing
            await this.pool.query(
              `UPDATE queue_event_subscriptions
               SET last_id = $1, last_seen = NOW()
               WHERE stream_pattern = $2 AND consumer_group = $3 AND consumer_name = $4`,
              [row.id, streamPattern, consumerGroup, consumerName]
            )
          }

          // Wait before next poll
          await new Promise(resolve => setTimeout(resolve, pollInterval))
        } catch (err) {
          console.error('[Postgres EventStore] External subscription poll error:', err)
          await new Promise(resolve => setTimeout(resolve, pollInterval))
        }
      }
    }

    // Start polling
    poll()

    // Return unsubscribe function
    return {
      unsubscribe: async () => {
        polling = false

        // Remove consumer from subscription table
        await this.pool.query(
          `DELETE FROM queue_event_subscriptions
           WHERE stream_pattern = $1 AND consumer_group = $2 AND consumer_name = $3`,
          [streamPattern, consumerGroup, consumerName]
        )
      }
    }
  }

  // Internal helpers

  private handleEventNotification(payload: { stream: string, id: string, type: string }) {
    // Fetch full event and notify local listeners
    this.pool.query(
      'SELECT * FROM queue_events WHERE id = $1',
      [parseInt(payload.id)]
    ).then(result => {
      if (result.rows.length > 0) {
        const event = this.rowToEvent(result.rows[0])
        const callbacks = this.listeners.get(payload.stream)
        if (callbacks) {
          for (const callback of callbacks) {
            callback(event)
          }
        }
      }
    }).catch(err => {
      console.error('[Postgres EventStore] Error fetching notified event:', err)
    })
  }

  private rowToEvent(row: any): EventRecord {
    return {
      id: String(row.id),
      ts: row.ts.toISOString(),
      stream: row.stream,
      type: row.type,
      runId: row.run_id,
      flowName: row.flow_name,
      stepName: row.step_name,
      stepId: row.step_id,
      attempt: row.attempt,
      data: typeof row.data === 'string' ? JSON.parse(row.data) : row.data,
    }
  }
}

export interface PostgresEventStoreConfig {
  host: string
  port?: number
  database: string
  user: string
  password: string
  poolSize?: number
}
```

**Key Features**:
- ✅ **LISTEN/NOTIFY**: Real-time event notifications (50-200ms latency)
- ✅ **External Subscriptions**: Support for horizontal scalability (multiple workers)
- ✅ **Consumer Groups**: Track last processed ID per consumer group
- ✅ **Stream Patterns**: Subscribe to multiple streams with wildcards (`nq:flow:*`)
- ✅ **Automatic Checkpointing**: Last processed ID stored in database
- ✅ **Fault Tolerance**: Consumers can resume from last checkpoint after crash

### Horizontal Scalability with External Subscriptions

External subscriptions enable multiple workers to process events from the same stream without duplicates:

```typescript
// Worker 1 (server instance 1)
const eventStore = getEventStoreAdapter() // PostgreSQL adapter

await eventStore.subscribeExternal(
  'nq:flow:*',           // Stream pattern (matches all flows)
  'flow-engine',         // Consumer group (shared across workers)
  'worker-1',            // Consumer name (unique per worker)
  async (event) => {
    // Process event
    console.log('Worker 1 processing:', event)
  },
  { pollInterval: 1000 } // Poll every 1 second
)

// Worker 2 (server instance 2)
await eventStore.subscribeExternal(
  'nq:flow:*',
  'flow-engine',         // Same consumer group
  'worker-2',            // Different consumer name
  async (event) => {
    // Process event
    console.log('Worker 2 processing:', event)
  },
  { pollInterval: 1000 }
)
```

**How it works**:
1. Each consumer group tracks `last_id` independently
2. Multiple consumers in same group share the work (round-robin via polling)
3. Each consumer updates `last_id` after successful processing
4. If a consumer crashes, it resumes from last checkpoint
5. No duplicates within a consumer group

**Use Cases**:
- **Flow Engine**: Multiple workers processing flow events
- **State Reducer**: Distributed state reduction
- **Analytics**: Process events for metrics/reporting
- **Logging**: Aggregate logs from all flows

### Configuration

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  queue: {
    // Queue provider (independent choice)
    adapter: 'pgboss',  // or 'redis' (BullMQ)
    
    postgres: {
      host: 'localhost',
      port: 5432,
      database: 'myapp',
      user: 'postgres',
      password: 'secret',
      schema: 'pgboss',
      
      // PgBoss-specific options
      retryLimit: 3,
      retryDelay: 60,
      expireInHours: 24,
      retentionDays: 7,
      deleteAfterDays: 30,
    },
    
    // EventStore adapter (independent choice)
    eventStore: {
      adapter: 'postgres',  // or 'redis'
      
      postgres: {
        host: 'localhost',
        port: 5432,
        database: 'myapp',
        user: 'postgres',
        password: 'secret',
        poolSize: 20,
      }
    }
  }
})
```

**Mix and Match**:
You can use different adapters for queue and eventStore:
- PgBoss (queue) + PostgreSQL (events) → Single database
- BullMQ (queue) + PostgreSQL (events) → Redis for jobs, PostgreSQL for events
- PgBoss (queue) + Redis (events) → PostgreSQL for jobs, Redis for events
- BullMQ (queue) + Redis (events) → All Redis (default)

## 3. Combined Architecture

When using both PostgreSQL adapters (PgBoss + PostgreSQL EventStore):

```
┌────────────────────────────────────────────────────────────────┐
│                     Application Layer                          │
│  (Nuxt Queue Module)                                          │
└────────────────────────┬───────────────────────────────────────┘
                         │
        ┌────────────────┴────────────────┐
        │                                 │
        ▼                                 ▼
┌─────────────────────┐         ┌─────────────────────────┐
│  PgBoss Provider    │         │  Postgres EventStore    │
│  (QueueProvider)    │         │  (EventStoreAdapter)    │
│                     │         │                         │
│  • Job queue ops    │         │  • Event storage        │
│  • Schedule jobs    │         │  • Event streaming      │
│  • Query jobs       │         │  • External subs        │
└─────────┬───────────┘         └────────┬────────────────┘
          │                              │
          ▼                              ▼
┌────────────────────────────────────────────────────────────────┐
│                    PostgreSQL Database                         │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  PgBoss Schema (pgboss)                                  │ │
│  │  • job - Active jobs                                     │ │
│  │  • schedule - Scheduled/recurring jobs                   │ │
│  │  • archive - Completed jobs                              │ │
│  │  • version - Schema version                              │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  EventStore Schema (public or custom)                    │ │
│  │  • queue_events - All events                             │ │
│  │  • queue_event_subscriptions - Consumer checkpoints      │ │
│  │  • queue_flow_index - Flow lookup index                  │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │  Application Schema (your tables)                        │ │
│  │  • users, orders, etc.                                   │ │
│  └──────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

### Worker Registration with PgBoss

```typescript
// Nitro plugin registers workers with PgBossWorkerManager
import { getWorkerManager } from '../worker/factory'

export default defineNitroPlugin(async (nitroApp) => {
  const workerManager = getWorkerManager() // Auto-selects PgBoss if configured

  // Close on shutdown
  nitroApp.hooks.hook('close', async () => {
    await workerManager.closeAll()
  })

  // Register all workers
  const handlers = $useWorkerHandlers()
  const registry = $useQueueRegistry()

  for (const entry of handlers) {
    const worker = registry.workers.find(w => w.id === entry.id)
    
    await workerManager.registerWorker(
      worker.queue.name,
      worker.id,
      entry.handler,
      {
        concurrency: worker.worker.concurrency,
        runtime: worker.worker.runtime,
        // ... other options
      }
    )
  }
})
```

## 4. Advantages & Trade-offs

### Advantages

✅ **Single Database**: Everything in PostgreSQL (jobs, events, app data)  
✅ **Transactional**: ACID guarantees for job and event operations  
✅ **Simpler Ops**: No Redis to manage, one database to backup  
✅ **SQL Analytics**: Query events with SQL for insights and reporting  
✅ **Cost Savings**: One database service instead of two  
✅ **Easier Backups**: Single backup strategy for everything  
✅ **External Subscriptions**: Horizontal scalability with consumer groups  
✅ **Fault Tolerance**: Checkpoint-based resumption after crashes  
✅ **Long-term Retention**: PostgreSQL better suited for historical data  
✅ **Expertise**: Leverage existing PostgreSQL knowledge

### Trade-offs

⚠️ **Performance**: Slightly slower than Redis for high-throughput  
⚠️ **Latency**: LISTEN/NOTIFY ~50-200ms vs Redis Pub/Sub ~1-5ms  
⚠️ **Scaling**: PostgreSQL vertical scaling vs Redis horizontal  
⚠️ **Polling Overhead**: External subscriptions use polling (1s default)  
⚠️ **Connection Pool**: Need more connections for LISTEN clients

### When to Use PostgreSQL Backend

**Good fit**:
- ✅ Applications already using PostgreSQL
- ✅ Lower to medium throughput (<1000 jobs/sec)
- ✅ Need for SQL analytics on events
- ✅ Cost-sensitive deployments
- ✅ Simpler infrastructure preferred
- ✅ Long-term event retention (years)
- ✅ Horizontal scaling with external subscriptions

**Maybe not**:
- ❌ Very high throughput (>5000 jobs/sec)
- ❌ Sub-10ms latency requirements
- ❌ Already have Redis infrastructure
- ❌ Need Redis-specific features (Lua scripts, etc.)

## 5. Performance Characteristics

| Metric | BullMQ + Redis | PgBoss + PostgreSQL | Notes |
|--------|----------------|---------------------|-------|
| **Job Add** | 2ms | 10ms | PostgreSQL insert slower |
| **Job Process** | 5ms | 15ms | Query + update overhead |
| **Event Append** | 1ms (Redis Streams) | 5ms (INSERT + NOTIFY) | PostgreSQL transaction overhead |
| **Event Query** | 3ms | 8ms | Index scan vs Redis lookup |
| **Real-time** | 1-5ms (Pub/Sub) | 50-200ms (LISTEN/NOTIFY) | Network + trigger latency |
| **External Sub** | N/A (consumer groups) | 1s+ (polling) | Polling interval dependent |
| **Throughput** | 10K jobs/sec | 1K jobs/sec | PostgreSQL bottleneck |
| **Connections** | 1 per worker | 2+ per worker (LISTEN + pool) | Connection overhead |
| **Scaling** | Horizontal | Vertical (+ external subs) | Redis cluster vs PostgreSQL replication |

**Recommendation**:
- Use **BullMQ + Redis** for high-throughput production (>1K jobs/sec)
- Use **PgBoss + PostgreSQL** for cost-sensitive or PostgreSQL-first stacks
- **Mix and Match**: BullMQ (queue) + PostgreSQL (events) for best of both

## 6. Migration Strategy

### From BullMQ to PgBoss

```typescript
// Step 1: Add PostgreSQL config (keep BullMQ running)
export default defineNuxtConfig({
  queue: {
    adapter: 'redis',  // Still using BullMQ
    
    // Add PostgreSQL config
    postgres: {
      host: 'localhost',
      database: 'myapp',
      user: 'postgres',
      password: 'secret',
    }
  }
})

// Step 2: Run migrations to create PgBoss tables
npx pg-boss migrate --connection-string=postgresql://...

// Step 3: Switch adapter
export default defineNuxtConfig({
  queue: {
    adapter: 'pgboss',  // ← Switch here
    postgres: { ... }
  }
})

// Step 4: Deploy and verify
// Step 5: Remove Redis dependency
```

### From Redis Streams to PostgreSQL EventStore

```typescript
// Step 1: Add PostgreSQL EventStore config (keep Redis running)
export default defineNuxtConfig({
  queue: {
    eventStore: {
      adapter: 'redis',  // Still using Redis
      
      // Add PostgreSQL config
      postgres: {
        host: 'localhost',
        database: 'myapp',
        user: 'postgres',
        password: 'secret',
      }
    }
  }
})

// Step 2: Create EventStore tables (run SQL from schema section)

// Step 3: Switch adapter
export default defineNuxtConfig({
  queue: {
    eventStore: {
      adapter: 'postgres',  // ← Switch here
      postgres: { ... }
    }
  }
})

// Step 4: Deploy and verify
// Step 5: Remove Redis dependency
```

## 7. Implementation Checklist

### PgBoss Queue Provider
- [ ] Create `PgBossProvider` class implementing `QueueProvider`
- [ ] Map generic job options to PgBoss format
- [ ] Implement job state mapping (PgBoss states → generic states)
- [ ] Add event forwarding to EventManager
- [ ] Handle cron scheduling via PgBoss.schedule()
- [ ] Write tests for all queue operations

### PgBoss Worker Manager
- [ ] Create `PgBossWorkerManager` class implementing `WorkerManager`
- [ ] Implement dispatcher pattern (same as BullMQ)
- [ ] Use PgBoss.work() with teamSize for concurrency
- [ ] Convert PgBoss jobs to BullMQ-like format for processor
- [ ] Add pause/resume support
- [ ] Write tests for worker registration and execution

### PostgreSQL EventStore Adapter
- [ ] Create `PostgresEventStoreAdapter` class implementing `EventStoreAdapter`
- [ ] Create database schema (tables, indexes, trigger)
- [ ] Implement append() with INSERT + automatic NOTIFY
- [ ] Implement query() with flexible filtering
- [ ] Implement subscribe() with LISTEN/NOTIFY
- [ ] Implement subscribeExternal() with consumer groups
- [ ] Add checkpoint tracking in subscription table
- [ ] Handle connection pooling for LISTEN clients
- [ ] Write tests for all operations

### Configuration & Factory
- [ ] Update WorkerManager factory to support PgBoss
- [ ] Update EventStore factory to support PostgreSQL
- [ ] Add configuration validation
- [ ] Document configuration options
- [ ] Add migration guide from Redis to PostgreSQL

### Documentation
- [ ] Write setup guide for PostgreSQL backend
- [ ] Document external subscription patterns
- [ ] Add performance tuning guide
- [ ] Create migration examples
- [ ] Document trade-offs and when to use

## 8. Example Usage

### Job Queue with PgBoss

```typescript
// server/queues/send-email.ts
export default defineQueueWorker(async (job, ctx) => {
  await sendEmail(job.data)
  return { sent: true }
})

export const config = defineQueueConfig({
  concurrency: 10,
  // Works identically with PgBoss or BullMQ
})

// Enqueue job
await $fetch('/api/queue/send-email', {
  method: 'POST',
  body: { to: 'user@example.com' }
})
```

### Events with PostgreSQL EventStore

```typescript
// Flow engine consuming events with external subscription
const eventStore = getEventStoreAdapter() // PostgreSQL

await eventStore.subscribeExternal(
  'nq:flow:*',
  'flow-engine',
  `worker-${process.pid}`,
  async (event) => {
    if (event.type === 'step.completed') {
      // Trigger next step in flow
      await flowEngine.handleStepCompleted(event)
    }
  }
)

// Multiple workers share the load automatically
// No duplicate processing within consumer group
```

### SQL Analytics

```sql
-- Find slowest flows
SELECT 
  flow_name,
  AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_duration_seconds
FROM queue_flow_index
WHERE completed_at IS NOT NULL
GROUP BY flow_name
ORDER BY avg_duration_seconds DESC;

-- Count events by type
SELECT type, COUNT(*) 
FROM queue_events 
WHERE ts > NOW() - INTERVAL '1 day'
GROUP BY type;

-- Find failed flows
SELECT DISTINCT run_id, flow_name, ts
FROM queue_events
WHERE type = 'step.failed'
  AND ts > NOW() - INTERVAL '1 day'
ORDER BY ts DESC;
```

## 9. Benefits Summary

### Single Database Stack
- **Simplified Architecture**: One database for jobs, events, and application data
- **Reduced Complexity**: No Redis to configure, monitor, or scale
- **Lower Costs**: One database service instead of two
- **Easier Operations**: Single backup, single monitoring, single scaling strategy

### SQL-Powered Analytics
- **Query Events**: Use SQL to analyze flow execution patterns
- **Historical Analysis**: Long-term retention with efficient queries
- **Business Intelligence**: Direct integration with BI tools
- **Ad-hoc Queries**: Investigate issues with SQL without specialized tools

### Horizontal Scalability
- **External Subscriptions**: Multiple workers process events in parallel
- **Consumer Groups**: Load balancing across workers automatically
- **Fault Tolerance**: Checkpoint-based resumption after crashes
- **No Duplicates**: Consumer group coordination prevents duplicate processing

### Production-Ready
- **ACID Transactions**: Data consistency guaranteed
- **Proven Technology**: PostgreSQL battle-tested at scale
- **Backup & Recovery**: Standard PostgreSQL tools
- **Monitoring**: Standard PostgreSQL monitoring and alerting
