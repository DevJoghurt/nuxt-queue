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
    '@nvent-addon/adapter-queue-postgres',
    'nvent'
  ],
  
  nvent: {
    // Shared connections (used by all adapters)
    connections: {
      postgres: {
        connectionString: 'postgresql://user:password@localhost:5432/myapp'
        // or use individual settings:
        // host: 'localhost',
        // port: 5432,
        // database: 'myapp',
        // user: 'postgres',
        // password: 'postgres',
      }
    },
    
    queue: {
      adapter: 'postgres',
      schema: 'nvent_queue', // Schema for pg-boss tables (default: 'pgboss')
      prefix: 'nvent',
      worker: {
        concurrency: 2,
        autorun: true
      }
    }
  }
})
```

## Configuration

The adapter uses shared connections from `nvent.connections.postgres` or can be configured via `nvent.queue`:

```typescript
nvent: {
  connections: {
    postgres: {
      connectionString: process.env.DATABASE_URL,
      // or individual settings:
      host: 'localhost',
      port: 5432,
      database: 'myapp',
      user: 'postgres',
      password: 'postgres',
      ssl: true, // or SSL config object
      max: 10 // max connections in pool
    }
  },
  
  queue: {
    adapter: 'postgres',
    schema: 'nvent_queue', // Schema for pg-boss tables (default: 'pgboss')
    prefix: 'nvent',
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000
      },
      timeout: 120000,
      removeOnComplete: 100,
      removeOnFail: 50
    },
    worker: {
      concurrency: 2,
      autorun: true,
      pollingIntervalMs: 1000
    }
  }
}

// Advanced pg-boss options (via module config)
nventQueuePostgres: {
  schema: 'custom_schema',
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

- ✅ pg-boss v12.5.2 integration for robust job processing
- ✅ PostgreSQL-based queue storage with ACID guarantees
- ✅ Delayed and scheduled jobs (cron support)
- ✅ Job retries with exponential backoff
- ✅ Distributed workers with configurable concurrency
- ✅ Dispatcher pattern - multiple job types per queue
- ✅ Production-ready with persistence
- ✅ Automatic maintenance and archival
- ✅ Built-in monitoring via SQL queries and programmatic API
- ✅ Schema isolation for clean database organization
- ✅ Consistent event emission (step.started, step.completed, step.failed, step.retry)

## Database Setup

pg-boss will automatically create the necessary tables in your PostgreSQL database when the adapter initializes. Make sure your database user has the necessary permissions to create tables and schemas.

### Manual Schema Creation (Optional)

If you prefer to create the schema manually or your database user doesn't have schema creation permissions:

```sql
-- Create the schema (use your configured schema name)
CREATE SCHEMA IF NOT EXISTS nvent_queue;

-- Grant necessary permissions
GRANT ALL ON SCHEMA nvent_queue TO your_user;
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
// server/functions/send-email.ts
export const config = defineFunctionConfig({
  queue: { name: 'email_queue' }
})

export default defineFunction(async (input) => {
  await sendEmail(input.to, input.subject, input.body)
  return { sent: true }
})

// Enqueue from anywhere
await $nvent.queue.enqueue('email_queue', {
  name: 'send-email',
  data: {
    to: 'user@example.com',
    subject: 'Welcome',
    body: 'Welcome to our app!'
  }
})
```

### Delayed Jobs

```typescript
// Send email after 1 hour
await $nvent.queue.enqueue('email_queue', {
  name: 'send-email',
  data: {
    to: 'user@example.com',
    subject: 'Reminder',
    body: 'Don\'t forget!'
  },
  options: {
    delay: 3600000 // 1 hour in milliseconds
  }
})
```

### Scheduled/Cron Jobs

```typescript
// Send daily digest at 9 AM
await $nvent.queue.enqueue('digest_queue', {
  name: 'send-daily-digest',
  data: { userId: '123' },
  options: {
    cron: '0 9 * * *' // 9 AM every day
  }
})
```

### Job Options

```typescript
await $nvent.queue.enqueue('order_queue', {
  name: 'process-order',
  data: orderData,
  options: {
    attempts: 5, // Retry up to 5 times
    backoff: {
      type: 'exponential',
      delay: 2000 // Start with 2s delay
    },
    priority: 10, // Higher priority
    timeout: 30000, // 30 second timeout
  }
})
```

## Migration from Memory/File Adapters

Simply change your configuration and restart:

```typescript
// Before (development)
nvent: {
  queue: {
    adapter: 'file'
  }
}

// After (production)
nvent: {
  connections: {
    postgres: {
      connectionString: process.env.DATABASE_URL
    }
  },
  queue: {
    adapter: 'postgres',
    schema: 'nvent_queue'
  }
}
```

All your existing job handlers and code remain the same! The adapter handles the queue abstraction.

## Monitoring

pg-boss provides built-in monitoring capabilities. You can query job states directly from PostgreSQL:

```sql
-- View active jobs (replace nvent_queue with your schema)
SELECT * FROM nvent_queue.job WHERE state = 'active';

-- View failed jobs
SELECT * FROM nvent_queue.job WHERE state = 'failed' ORDER BY createdon DESC LIMIT 10;

-- Job counts by state
SELECT state, COUNT(*) FROM nvent_queue.job GROUP BY state;

-- View archived jobs
SELECT * FROM nvent_queue.archive WHERE completedon IS NOT NULL ORDER BY completedon DESC LIMIT 10;

-- Check job details with metadata
SELECT id, name, data, state, retrylimit, retrycount, createdon, startedon, completedon 
FROM nvent_queue.job 
WHERE name = 'your-job-name' 
ORDER BY createdon DESC;
```

The adapter also provides programmatic access to job information:

```typescript
// Get job by ID
const job = await $nvent.queue.getJob('queue-name', 'job-id')

// Get all jobs in a queue
const jobs = await $nvent.queue.getJobs('queue-name', {
  state: ['active', 'failed'],
  limit: 50,
  offset: 0
})

// Get job counts
const counts = await $nvent.queue.getJobCounts('queue-name')
console.log(counts) // { active: 5, completed: 100, failed: 2, ... }
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
