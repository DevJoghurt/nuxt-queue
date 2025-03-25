export default defineNuxtConfig({
  modules: [
    '@nuxt/ui',
    '../src/module',
  ],

  devtools: {
    enabled: true,
  },

  css: ['~/assets/css/main.css'],

  colorMode: {
    preference: 'light',
  },

  compatibilityDate: '2025-02-24',

  queue: {
    ui: true,
    redis: {
      host: '127.0.0.1',
      port: 6379
    },
    queues: {
      CronQueue: {
        origin: 'remote',
      },
      DownloadQueue: {
        origin: 'remote',
      },
      ReindexQueue: {
        origin: 'remote',
      },
      SubscriptionQueue: {
        origin: 'remote',
      },
    },
  },
})
