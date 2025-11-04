export default defineNuxtConfig({
  modules: [
    '@nuxt/ui',
    'nuxt-mcp',
    '../src/module',
  ],

  devtools: {
    enabled: true,
  },

  css: ['~/assets/css/main.css'],

  colorMode: {
    preference: 'light',
  },

  runtimeConfig: {
    queue: {
      eventStore: {
        name: 'redis',
        mode: 'streams',
      },
      workers: {
        concurrency: 5,
      },
    },
  },

  queue: {
    debug: { events: true },
    // Default configurations for all queues
    defaultQueueConfig: {
      prefix: 'nq',
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    },
    // Default configurations for all workers
    defaultWorkerConfig: {
      concurrency: 2,
      lockDurationMs: 30000,
      maxStalledCount: 1,
    },
  },
})
