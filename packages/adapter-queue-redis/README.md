# @nvent/adapter-queue-redis

Redis queue adapter for nvent using BullMQ.

## Installation

```bash
pnpm add @nvent/adapter-queue-redis
```

## Usage

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  modules: [
    'nvent',
    '@nvent/adapter-queue-redis'
  ],
  
  nvent: {
    queue: {
      adapter: 'redis',
      redis: {
        host: 'localhost',
        port: 6379,
        // or use url
        // url: process.env.REDIS_URL
      }
    }
  }
})
```

## Configuration

The adapter accepts all BullMQ connection options:

```typescript
nventQueueRedis: {
  connection: {
    host: 'localhost',
    port: 6379,
    username: 'default',
    password: 'your-password',
    db: 0
  },
  prefix: 'nvent', // Queue prefix
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000
    }
  }
}
```

## Features

- ✅ BullMQ integration for robust job processing
- ✅ Redis-based queue storage
- ✅ Delayed and scheduled jobs
- ✅ Job retries with exponential backoff
- ✅ Queue pause/resume
- ✅ Distributed workers
- ✅ Production-ready

## License

MIT
