# Postgres Backend - Queue & Event Storage

> **Version**: v0.6.1  
> **Status**: 📋 Planning  
> **Last Updated**: 2025-10-30

## Goal

Offer Postgres-based solutions as alternatives to Redis for both queue management (PgBoss) and event storage.

## 1. PgBoss as Queue Provider

### Why PgBoss?

- **Single Database**: No Redis dependency
- **Transactional**: ACID guarantees
- **Simpler Stack**: One less service to manage
- **Cost Effective**: No Redis hosting costs
- **Built-in Persistence**: Postgres is already persistent

### Implementation

```typescript
// Queue provider adapter
export class PgBossAdapter implements QueueProvider {
  async init() {
    this.boss = new PgBoss({
      host: config.postgres.host,
      database: config.postgres.database,
      ...
    })
    await this.boss.start()
  }
  
  async enqueue(queue: string, job: JobInput): Promise<string> {
    return await this.boss.send(queue, job.data, job.opts)
  }
  
  // ... implement other methods
}
```

### Configuration

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  queue: {
    provider: {
      name: 'pgboss',  // or 'bullmq'
      postgres: {
        host: 'localhost',
        database: 'myapp',
        user: 'postgres',
        password: 'secret'
      }
    }
  }
})
```

### Migration Path

- Auto-detect which provider to use based on config
- Support both simultaneously during migration
- Provide migration tools for moving jobs

### Benefits
- Simpler infrastructure
- ACID transactions
- Existing Postgres expertise
- Lower operational complexity

## 2. Postgres Adapter for Stream Store

### Schema

```sql
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
  data JSONB,
  INDEX idx_stream (stream),
  INDEX idx_run_id (run_id),
  INDEX idx_ts (ts)
);

CREATE TABLE queue_flow_index (
  flow_name VARCHAR(255) NOT NULL,
  run_id UUID NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (flow_name, run_id),
  INDEX idx_started (flow_name, started_at DESC)
);
```

### Adapter Implementation

```typescript
export class PostgresStreamAdapter implements StreamAdapter {
  async append(subject: string, event: EventRecord): Promise<EventRecord> {
    const result = await this.db.query(
      `INSERT INTO queue_events 
       (stream, type, run_id, flow_name, step_name, data) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING id, ts`,
      [subject, event.type, event.runId, event.flowName, event.stepName, event.data]
    )
    
    // Notify listeners via Postgres NOTIFY
    await this.db.query('NOTIFY queue_events, $1', [JSON.stringify({
      stream: subject,
      id: result.rows[0].id
    })])
    
    return { ...event, id: String(result.rows[0].id), ts: result.rows[0].ts }
  }
  
  async subscribe(subject: string, onEvent: (e: EventRecord) => void) {
    // Use Postgres LISTEN/NOTIFY
    await this.db.query('LISTEN queue_events')
    
    this.db.on('notification', async (msg) => {
      if (msg.channel === 'queue_events') {
        const { stream, id } = JSON.parse(msg.payload)
        if (stream === subject) {
          const event = await this.getEvent(id)
          onEvent(event)
        }
      }
    })
    
    return { unsubscribe: () => this.db.query('UNLISTEN queue_events') }
  }
}
```

### Real-time with Postgres

Use Postgres LISTEN/NOTIFY for real-time updates:
- INSERT triggers NOTIFY
- SSE endpoints LISTEN
- Similar latency to Redis Pub/Sub (<200ms)

### Configuration

```typescript
export default defineNuxtConfig({
  queue: {
    eventStore: {
      adapter: 'postgres',  // or 'redis'
      postgres: {
        // Use Nitro's database config
        connectionString: process.env.DATABASE_URL
      }
    }
  }
})
```

### Benefits
- Single database for everything
- SQL queries for analytics
- Better long-term retention
- Easier backup/restore
- Transactional guarantees

## Combined Architecture

When using both Postgres adapters:

```
┌────────────────────────────────────────┐
│         Application Layer              │
│  (Nuxt Queue Module)                  │
└──────────────┬─────────────────────────┘
               │
               ▼
┌────────────────────────────────────────┐
│         Postgres Database              │
│                                        │
│  ┌──────────────────────────────────┐ │
│  │  PgBoss Tables                   │ │
│  │  - job queues                    │ │
│  │  - schedules                     │ │
│  │  - archives                      │ │
│  └──────────────────────────────────┘ │
│                                        │
│  ┌──────────────────────────────────┐ │
│  │  Event Store Tables              │ │
│  │  - queue_events                  │ │
│  │  - queue_flow_index              │ │
│  └──────────────────────────────────┘ │
│                                        │
│  ┌──────────────────────────────────┐ │
│  │  Application Tables              │ │
│  │  - users, orders, etc.           │ │
│  └──────────────────────────────────┘ │
└────────────────────────────────────────┘
```

### Advantages

✅ **Single Database**: Everything in Postgres  
✅ **Transactional**: Cross-table transactions possible  
✅ **Simpler Ops**: No Redis to manage  
✅ **SQL Analytics**: Query events with SQL  
✅ **Cost Savings**: One database service  
✅ **Easier Backups**: Single backup strategy

### Trade-offs

⚠️ **Performance**: Slightly slower than Redis for high-throughput  
⚠️ **Scaling**: Postgres vertical scaling vs Redis horizontal  
⚠️ **Latency**: LISTEN/NOTIFY ~50-200ms vs Redis Pub/Sub ~1-5ms

### When to Use Postgres Backend

**Good fit**:
- Applications already using Postgres
- Lower to medium queue throughput (<1000 jobs/sec)
- Need for SQL analytics on events
- Cost-sensitive deployments
- Simpler infrastructure preferred

**Maybe not**:
- Very high throughput requirements (>5000 jobs/sec)
- Sub-10ms latency requirements
- Already have Redis infrastructure
- Need Redis-specific features
