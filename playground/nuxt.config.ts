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

  queue: {
    debug: {
      // Global log level: 'debug' | 'info' | 'warn' | 'error' | 'silent'
      level: 'warn',
    },

    // Shortcut: Configure all backends to use Redis
    store: {
      adapter: 'redis',
      redis: {
        host: '127.0.0.1',
        port: 6379,
      },
    },
    state: {
      adapter: 'redis',
      cleanup: {
        strategy: 'on-complete',
      },
    },
    // You can still override individual configs:
    eventStore: {
      adapter: 'file', // Use file for events in development
    },
    queue: {
      adapter: 'redis',
      defaultConfig: {
        // Queue options
        prefix: 'nq',
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 1000,
          },
          timeout: 120000,
          removeOnComplete: 100,
          removeOnFail: 50,
        },
        // Worker options
        worker: {
          concurrency: 2,
          lockDurationMs: 120000,
          maxStalledCount: 2,
        },
      },
    },
  },
})
