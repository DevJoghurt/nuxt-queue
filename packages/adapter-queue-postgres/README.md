# @nvent/adapter-queue-postgres

PostgreSQL queue adapter for nvent using pg-boss.

## Installation

```bash
pnpm add @nvent/adapter-queue-postgres
```

## Usage

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  modules: [
    'nvent',
    '@nvent/adapter-queue-postgres'
  ],
  
  nvent: {
    queue: {
      adapter: 'postgres',
      postgres: {
        host: 'localhost',
        port: 5432,
        database: 'myapp',
        user: 'postgres',
        password: 'postgres',
        // or use connection string
        // connectionString: process.env.DATABASE_URL
      }
    }
  }
})
```

## Configuration

The adapter accepts all pg-boss connection options:

```typescript
nventQueuePostgres: {
  connection: {
    host: 'localhost',
    port: 5432,
    database: 'myapp',
    user: 'postgres',
    password: 'postgres',
    // or use connection string
    connectionString: process.env.DATABASE_URL,
    ssl: true, // or SSL config object
    max: 10 // max connections in pool
  },
  schema: 'pgboss', // Database schema for pg-boss tables
  retryLimit: 3,
  retryDelay: 1000,
  retryBackoff: true,
  expireInSeconds: 3600,
  archiveCompletedAfterSeconds: 86400, // 24 hours
  deleteAfterDays: 7,
  retentionDays: 7,
  maintenanceIntervalSeconds: 120
}
```

## Configuration Options

### Connection Options

- `host` - PostgreSQL host (default: 'localhost')
- `port` - PostgreSQL port (default: 5432)
- `database` - Database name
- `user` - Database user
- `password` - Database password
- `connectionString` - PostgreSQL connection string (alternative to individual settings)
- `ssl` - Enable SSL (boolean or config object)
- `max` - Maximum number of connections in pool (default: 10)

### Queue Options

- `schema` - Database schema for pg-boss tables (default: 'pgboss')
- `retryLimit` - Maximum number of retry attempts for failed jobs (default: 3)
- `retryDelay` - Delay in milliseconds between retries
- `retryBackoff` - Use exponential backoff for retries (default: false)
- `expireInSeconds` - Time in seconds after which jobs expire if not processed
- `archiveCompletedAfterSeconds` - Archive completed jobs after this many seconds
- `deleteAfterDays` - Delete archived jobs after this many days (default: 7)
- `retentionDays` - Keep jobs for this many days before deletion
- `maintenanceIntervalSeconds` - Interval for pg-boss maintenance tasks (default: 120)

## Features

- ✅ pg-boss integration for robust job processing
- ✅ PostgreSQL-based queue storage
- ✅ Delayed and scheduled jobs (cron support)
- ✅ Job retries with exponential backoff
- ✅ Distributed workers
- ✅ Production-ready with persistence
- ✅ Automatic maintenance and archival
- ✅ Built-in monitoring and metrics

## Database Setup

pg-boss will automatically create the necessary tables in your PostgreSQL database when the adapter initializes. Make sure your database user has the necessary permissions to create tables and schemas.

### Manual Schema Creation (Optional)

If you prefer to create the schema manually or your database user doesn't have schema creation permissions:

```sql
-- Create the schema
CREATE SCHEMA IF NOT EXISTS pgboss;

-- Grant necessary permissions
GRANT ALL ON SCHEMA pgboss TO your_user;
```

Then pg-boss will create its tables within this schema on first startup.

## Comparison with Redis Adapter

### PostgreSQL Adapter (pg-boss)
- ✅ Persistent storage - survives restarts
- ✅ ACID compliance for job guarantees
- ✅ Built-in archival and retention policies
- ✅ Works with existing PostgreSQL infrastructure
- ⚠️ Slightly higher latency than Redis
- ⚠️ Limited real-time event streaming

### Redis Adapter (BullMQ)
- ✅ Extremely low latency
- ✅ Rich event system
- ✅ Advanced job prioritization
- ✅ Better for high-throughput scenarios
- ⚠️ Requires Redis infrastructure
- ⚠️ Persistence depends on Redis configuration

## Examples

### Basic Usage

```typescript
// Define a job handler
export default defineNventFunction('sendEmail', async (payload) => {
  await sendEmail(payload.to, payload.subject, payload.body)
  return { sent: true }
})

// Enqueue a job
await $nvent.enqueue('sendEmail', {
  to: 'user@example.com',
  subject: 'Welcome',
  body: 'Welcome to our app!'
})
```

### Delayed Jobs

```typescript
// Send email after 1 hour
await $nvent.schedule('sendEmail', {
  to: 'user@example.com',
  subject: 'Reminder',
  body: 'Don\'t forget!'
}, {
  delay: 3600000 // 1 hour in milliseconds
})
```

### Scheduled/Cron Jobs

```typescript
// Send daily digest at 9 AM
await $nvent.schedule('sendDailyDigest', {
  userId: '123'
}, {
  cron: '0 9 * * *' // 9 AM every day
})
```

### Job Options

```typescript
await $nvent.enqueue('processOrder', orderData, {
  attempts: 5, // Retry up to 5 times
  backoff: {
    type: 'exponential',
    delay: 2000 // Start with 2s delay
  },
  priority: 10, // Higher priority
  timeout: 30000, // 30 second timeout
})
```

## Migration from Memory/File Adapters

Simply change your configuration and restart:

```typescript
// Before (development)
nvent: {
  queue: {
    adapter: 'memory'
  }
}

// After (production)
nvent: {
  queue: {
    adapter: 'postgres',
    postgres: {
      connectionString: process.env.DATABASE_URL
    }
  }
}
```

All your existing job handlers and code remain the same!

## Monitoring

pg-boss provides built-in monitoring capabilities. You can query job states directly from PostgreSQL:

```sql
-- View active jobs
SELECT * FROM pgboss.job WHERE state = 'active';

-- View failed jobs
SELECT * FROM pgboss.job WHERE state = 'failed' ORDER BY createdon DESC LIMIT 10;

-- Job counts by state
SELECT state, COUNT(*) FROM pgboss.job GROUP BY state;
```

## Troubleshooting

### Connection Issues

If you see connection errors, verify:
1. PostgreSQL is running and accessible
2. Database credentials are correct
3. Database exists
4. User has necessary permissions

### Performance

For high-throughput scenarios:
- Increase `max` connection pool size
- Tune PostgreSQL settings (shared_buffers, work_mem)
- Consider partitioning pg-boss tables
- Monitor and optimize job payload sizes

## License

MIT
