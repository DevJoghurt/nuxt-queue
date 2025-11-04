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
    debug: { events: false },

    // Shortcut: Configure all backends to use Redis
    store: {
      name: 'redis',
      redis: {
        host: '127.0.0.1',
        port: 6379,
      },
    },
    // You can still override individual configs:
    // eventStore: {
    //   name: 'memory',  // Use memory for events in development
    // },
    queue: {
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
