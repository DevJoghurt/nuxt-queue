export default defineNuxtConfig({
  modules: [
    '@nuxt/ui',
    'nuxt-mcp',
    // Load adapter modules BEFORE nvent so they can register themselves
    '@nvent/adapter-queue-redis',
    '@nvent/adapter-stream-redis',
    '@nvent/adapter-store-redis',
    'nvent',
    '@nvent/app',
  ],

  imports: {
    autoImport: false,
  },

  devtools: {
    enabled: true,
  },

  css: ['~/assets/css/main.css'],

  colorMode: {
    preference: 'light',
  },

  nvent: {
    debug: {
      // Global log level: 'debug' | 'info' | 'warn' | 'error' | 'silent'
      level: 'info',
    },

    // v0.4.1: New config structure with shared connections
    connections: {
      redis: {
        host: '127.0.0.1',
        port: 6379,
      },
      file: {
        dataDir: '.data',
      },
    },

    // Queue adapter configuration
    queue: {
      adapter: 'file', // Use file for development (change to 'redis' for production)
      // redis connection inherited from connections.redis
      prefix: 'nvent',
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
      worker: {
        concurrency: 2,
        autorun: true,
        lockDurationMs: 120000,
        maxStalledCount: 2,
        pollingIntervalMs: 1000,
      },
    },

    // Stream adapter configuration
    stream: {
      adapter: 'redis', // Use memory for single-instance dev
      prefix: 'nvent',
    },

    // Store adapter configuration
    store: {
      adapter: 'file', // Use file for development (change to 'redis' for production)
      // file.dataDir inherited from connections.file → becomes '.data/store'
      prefix: 'nvent',
      state: {
        autoScope: 'always',
        cleanup: {
          strategy: 'on-complete', // Clean up state when flows complete
        },
      },
      eventTTL: 604800, // 7 days
      metadataTTL: 2592000, // 30 days
    },
    flow: {
      stallDetection: {
        enabled: true,
        checkInterval: 15 * 60 * 1000, // 15 minutes
        enablePeriodicCheck: true,
      },
    },
  },
})
